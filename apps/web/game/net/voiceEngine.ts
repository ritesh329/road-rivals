import type { Socket } from "socket.io-client";

/**
 * Peer-to-peer voice chat (WebRTC mesh). The server only relays signalling (see apps/server/src/services/voice.ts).
 * Newcomers call everybody already on voice; existing members just answer.
 */
export interface VoiceHandlers {
  speaking: (id: string, on: boolean) => void;   // id === "me" for the local mic
  peers: (ids: string[]) => void;                // peers with an open audio link
  error: (msg: string) => void;
}

const stun: RTCIceServer = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };
/** Optional TURN relay (needed by some mobile / corporate networks): NEXT_PUBLIC_TURN_URL, _USER, _PASS */
function iceServers(): RTCIceServer[] {
  const url = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_TURN_URL : undefined;
  if (!url) return [stun];
  return [stun, { urls: url.split(","), username: process.env.NEXT_PUBLIC_TURN_USER, credential: process.env.NEXT_PUBLIC_TURN_PASS }];
}

type Sig = { type: "offer" | "answer"; sdp: string } | { type: "candidate"; candidate: RTCIceCandidateInit };
const SPEAK_LEVEL = 0.02; // RMS above this = "talking"

export class VoiceEngine {
  private stream: MediaStream | null = null;
  private pcs = new Map<string, RTCPeerConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private queued = new Map<string, RTCIceCandidateInit[]>();
  private known = new Set<string>();
  private ctx: AudioContext | null = null;
  private meters = new Map<string, { an: AnalyserNode; buf: Uint8Array<ArrayBuffer>; on: boolean }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  private active = false;
  private bound: [string, (...a: any[]) => void][] = [];

  constructor(private socket: Socket, private h: VoiceHandlers) {}

  get running() { return this.active; }

  async start(muted = false) {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone needs https:// (or localhost) and a modern browser");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      const n = (e as DOMException).name;
      throw new Error(n === "NotAllowedError" ? "Microphone permission was denied" : n === "NotFoundError" ? "No microphone found" : "Could not open the microphone");
    }
    this.active = true; this.muted = muted; this.setMuted(muted);
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC(); void this.ctx.resume().catch(() => {});
    this.meter("me", this.stream);
    this.timer = setInterval(() => this.tick(), 150);

    const on = (ev: string, fn: (...a: any[]) => void) => { this.socket.on(ev, fn); this.bound.push([ev, fn]); };
    on("voice:signal", (m: { from: string; data: Sig }) => void this.onSignal(m.from, m.data));
    on("voice:peer-joined", ({ id }: { id: string }) => { this.known.add(id); this.drop(id); }); // they will call us
    on("voice:peer-left", ({ id }: { id: string }) => { this.known.delete(id); this.drop(id); });
    on("game:player-left", ({ id }: { id: string }) => { this.known.delete(id); this.drop(id); });
    on("disconnect", () => { for (const id of [...this.pcs.keys()]) this.drop(id); });
    on("connect", () => void this.join());
    await this.join();
  }

  private async join() {
    const ack: { ok: boolean; error?: string; peers?: string[] } = await new Promise((res) => {
      const t = setTimeout(() => res({ ok: false, error: "Server did not answer" }), 6000);
      this.socket.emit("voice:join", {}, (r: any) => { clearTimeout(t); res(r); });
    });
    if (!ack.ok) {
      // right after a reconnect the session is re-joined a moment later: try again
      if (this.active && ack.error === "Join the session first") setTimeout(() => { if (this.active) void this.join(); }, 1500);
      else this.h.error(ack.error ?? "Could not join voice");
      return;
    }
    this.h.error("");
    for (const id of ack.peers ?? []) { this.known.add(id); await this.call(id); }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.socket.emit("voice:leave");
    for (const [ev, fn] of this.bound) this.socket.off(ev, fn);
    this.bound = [];
    for (const id of [...this.pcs.keys()]) this.drop(id);
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    void this.ctx?.close().catch(() => {}); this.ctx = null; this.meters.clear();
    this.h.speaking("me", false);
  }

  setMuted(m: boolean) { this.muted = m; this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m)); }
  /** push-to-talk: temporarily open the mic while muted */
  talk(on: boolean) { if (this.muted) this.stream?.getAudioTracks().forEach((t) => (t.enabled = on)); }

  // ------------------------------------------------------------ WebRTC
  private makePc(id: string) {
    this.drop(id);
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pcs.set(id, pc);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => { if (e.candidate) this.socket.emit("voice:signal", { to: id, data: { type: "candidate", candidate: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      let a = this.audios.get(id);
      if (!a) { a = new Audio(); a.autoplay = true; (a as HTMLAudioElement & { playsInline: boolean }).playsInline = true; a.style.display = "none"; document.body.appendChild(a); this.audios.set(id, a); }
      a.srcObject = stream; void a.play().catch(() => {});
      this.meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.h.peers([...this.pcs.entries()].filter(([, p]) => p.connectionState === "connected").map(([k]) => k));
      if (pc.connectionState === "failed") { this.h.error("A voice link failed (this network may need a TURN server)"); this.drop(id); }
    };
    return pc;
  }

  private async call(id: string) {
    const pc = this.makePc(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit("voice:signal", { to: id, data: { type: "offer", sdp: offer.sdp } });
  }

  private async onSignal(from: string, d: Sig) {
    try {
      if (d.type === "offer") {
        const pc = this.makePc(from);
        await pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
        await this.flush(from, pc);
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        this.socket.emit("voice:signal", { to: from, data: { type: "answer", sdp: ans.sdp } });
      } else if (d.type === "answer") {
        const pc = this.pcs.get(from); if (!pc) return;
        await pc.setRemoteDescription({ type: "answer", sdp: d.sdp }); await this.flush(from, pc);
      } else {
        const cand = (d as { candidate: RTCIceCandidateInit }).candidate;
        const pc = this.pcs.get(from);
        if (pc?.remoteDescription) await pc.addIceCandidate(cand).catch(() => {});
        else this.queued.set(from, [...(this.queued.get(from) ?? []), cand]);
      }
    } catch { /* stale / out-of-order message */ }
  }
  private async flush(id: string, pc: RTCPeerConnection) {
    for (const c of this.queued.get(id) ?? []) await pc.addIceCandidate(c).catch(() => {});
    this.queued.delete(id);
  }

  private drop(id: string) {
    const pc = this.pcs.get(id); if (pc) { pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); this.pcs.delete(id); }
    const a = this.audios.get(id); if (a) { a.srcObject = null; a.remove(); this.audios.delete(id); }
    this.queued.delete(id); this.meters.delete(id); this.h.speaking(id, false);
    this.h.peers([...this.pcs.entries()].filter(([, p]) => p.connectionState === "connected").map(([k]) => k));
  }

  // ------------------------------------------------------------ "who is talking" indicators
  private meter(id: string, s: MediaStream) {
    if (!this.ctx) return;
    const an = this.ctx.createAnalyser(); an.fftSize = 512;
    this.ctx.createMediaStreamSource(s).connect(an);
    this.meters.set(id, { an, buf: new Uint8Array(new ArrayBuffer(an.fftSize)), on: false });
  }
  private tick() {
    for (const [id, m] of this.meters) {
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0; for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; sum += v * v; }
      let on = Math.sqrt(sum / m.buf.length) > SPEAK_LEVEL;
      if (id === "me" && (this.muted && !this.stream?.getAudioTracks()[0]?.enabled)) on = false;
      if (on !== m.on) { m.on = on; this.h.speaking(id, on); }
    }
  }
}

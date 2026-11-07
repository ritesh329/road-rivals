"use client";
import type { VehiclePhysicsParams } from "@road-rivals/shared";

/** Procedural engine sound. Pitch follows RPM; timbre/volume follow the installed engine (hp, redline). */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode[] = [];
  private gain!: GainNode;
  private filter!: BiquadFilterNode;
  private hp = 100;
  private started = false;

  start(p: VehiclePhysicsParams) {
    this.setEngine(p);
    if (this.started) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain(); this.gain.gain.value = 0;
      this.filter = this.ctx.createBiquadFilter(); this.filter.type = "lowpass";
      this.filter.connect(this.gain); this.gain.connect(this.ctx.destination);
      for (const [type, mult, vol] of [["sawtooth", 1, 0.5], ["square", 0.5, 0.3], ["sawtooth", 2.01, 0.18]] as const) {
        const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = 40;
        const g = this.ctx.createGain(); g.gain.value = vol; (o as any)._mult = mult;
        o.connect(g); g.connect(this.filter); o.start(); this.osc.push(o);
      }
      this.started = true;
    } catch { /* audio unsupported */ }
  }
  setEngine(p: VehiclePhysicsParams) { this.hp = p.engine.powerHp; }
  update(rpm: number, throttle: number, enabled: boolean) {
    if (!this.ctx || !this.started) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    // more cylinders / power => lower fundamental per rpm, brighter filter, louder
    const cyl = this.hp > 500 ? 10 : this.hp > 330 ? 8 : this.hp > 220 ? 6 : 4;
    const base = (rpm / 60) * (cyl / 2);
    const t = this.ctx.currentTime;
    for (const o of this.osc) o.frequency.setTargetAtTime(base * (o as any)._mult, t, 0.04);
    this.filter.frequency.setTargetAtTime(500 + rpm * 0.35 + this.hp * 2.2 + throttle * 900, t, 0.05);
    const vol = enabled ? (0.035 + throttle * 0.05) * (0.8 + Math.min(this.hp, 800) / 1000) : 0;
    this.gain.gain.setTargetAtTime(vol, t, 0.08);
  }
  /** Crash thud + crunch; louder with impact size. */
  impact(mag: number, enabled: boolean) {
    if (!this.ctx || !this.started || !enabled) return;
    try {
      const ctx = this.ctx, t = ctx.currentTime, dur = 0.18 + Math.min(mag, 30) * 0.01;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600 + mag * 60;
      const g = ctx.createGain(); g.gain.value = Math.min(0.9, 0.12 + mag * 0.03);
      src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
    } catch { /* ignore */ }
  }
  stop() { try { this.osc.forEach((o) => o.stop()); void this.ctx?.close(); } catch { /* */ } this.started = false; }
}

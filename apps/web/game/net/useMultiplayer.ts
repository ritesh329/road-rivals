"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { NetPlayer } from "@road-rivals/shared";
import { SnapshotBuffer } from "@road-rivals/shared";
import { emitAck, getSocket } from "@/services/socket";
import { remote, useNet, type ChatMsg } from "./netStore";
import { useRace } from "../race/raceStore";

/**
 * Connects the /game page to a room: subscribes to the room channel (chat, room events), joins the
 * shared world (server assigns the seat/spawn) and keeps remote players + their snapshot buffers
 * up to date. Re-joins automatically after a reconnect.
 */
export function useMultiplayer(code: string | null) {
  const router = useRouter();
  useEffect(() => {
    if (!code) { useNet.getState().reset(); return; }
    const net = useNet;
    const s = getSocket();
    let alive = true;
    net.setState({ active: true, roomCode: code, ready: false, error: null });

    const addPlayer = (p: NetPlayer) => {
      remote.buffers.set(p.id, new SnapshotBuffer());
      if (p.state) remote.buffers.get(p.id)!.push(Date.now() - (remote.offset ?? 0), p.state);
      net.setState((st) => ({ players: { ...st.players, [p.id]: p } }));
    };

    const join = async () => {
      try {
        const sub = await emitAck("room:subscribe", { code });
        if (!alive) return;
        if (!sub.ok) { net.setState({ error: sub.error ?? "Could not open the room" }); return; }
        net.setState({ chat: sub.chat as ChatMsg[] });
        const j = await emitAck("game:join", { code });
        if (!alive) return;
        if (!j.ok) { net.setState({ error: j.error ?? "Could not join the session" }); return; }
        remote.buffers.clear(); net.setState({ players: {} });
        for (const p of j.players as NetPlayer[]) if (p.id !== j.selfId) addPlayer(p);
        useRace.getState().applyJoin({ ...j, solo: j.solo });
        net.setState({ selfId: j.selfId, seat: j.seat, spawn: { x: j.spawn.x, y: 1, z: j.spawn.z, yaw: j.spawn.yaw }, ready: true, connected: true, error: null });
      } catch (e) { net.setState({ error: (e as Error).message }); }
    };

    const onConnect = () => { net.setState({ connected: true }); void join(); };
    const onDisconnect = () => net.setState({ connected: false });
    const onJoined = (p: NetPlayer) => { if (p.id !== net.getState().selfId) addPlayer(p); };
    const onLeft = ({ id }: { id: string }) => {
      remote.buffers.delete(id); remote.pos.delete(id);
      net.setState((st) => { const { [id]: _gone, ...rest } = st.players; return { players: rest }; });
    };
    const onStates = (m: { t: number; s: ({ id: string } & Record<string, any>)[] }) => {
      const d = Date.now() - m.t;
      remote.offset = remote.offset === null ? d : remote.offset * 0.9 + d * 0.1;
      for (const { id, ...st } of m.s) { if (id === net.getState().selfId) continue; remote.buffers.get(id)?.push(m.t, st as any); }
    };
    const onCorrect = (c: { x: number; y: number; z: number; yaw?: number }) => net.setState({ correct: c });
    const onChat = (m: ChatMsg) => net.setState((st) => ({ chat: [...st.chat, m].slice(-40) }));
    const onReplaced = () => net.setState({ error: "This session was opened in another tab", ready: false });
    const onKicked = () => { router.replace("/rooms?kicked=1"); };
    const onClosed = () => { router.replace("/rooms"); };
    const onStopped = () => { router.replace(`/room/${code}`); };

    s.on("connect", onConnect); s.on("disconnect", onDisconnect);
    s.on("game:player-joined", onJoined); s.on("game:player-left", onLeft); s.on("game:states", onStates);
    s.on("game:correct", onCorrect); s.on("chat:message", onChat); s.on("game:replaced", onReplaced);
    s.on("room:kicked", onKicked); s.on("room:closed", onClosed); s.on("room:stopped", onStopped);
    if (s.connected) onConnect();

    return () => {
      alive = false;
      s.emit("game:leave");
      s.off("connect", onConnect); s.off("disconnect", onDisconnect);
      s.off("game:player-joined", onJoined); s.off("game:player-left", onLeft); s.off("game:states", onStates);
      s.off("game:correct", onCorrect); s.off("chat:message", onChat); s.off("game:replaced", onReplaced);
      s.off("room:kicked", onKicked); s.off("room:closed", onClosed); s.off("room:stopped", onStopped);
      remote.buffers.clear(); remote.pos.clear(); remote.offset = null;
      net.getState().reset();
    };
  }, [code, router]);
}

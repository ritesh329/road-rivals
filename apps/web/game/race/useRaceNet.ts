"use client";
import { useEffect } from "react";
import { targetGate } from "@road-rivals/shared";
import { getSocket } from "@/services/socket";
import { useNet } from "../net/netStore";
import { useRace, type RaceInfo, type RaceResults } from "./raceStore";

const fmt = (ms: number) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000); return `${m}:${String(s).padStart(2, "0")}.${String(x).padStart(3, "0")}`; };

/** Listens to the server's race events for the room this /game session is in. */
export function useRaceNet(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    const R = useRace;
    const onCountdown = (m: RaceInfo & { startAt: number; serverNow: number }) => {
      R.setState({
        phase: "countdown", info: m, startLocal: m.startAt + (Date.now() - m.serverNow), standings: [], myGates: 0, nextGate: targetGate(0),
        results: null, nextAtLocal: null, timeLeftMs: m.kind === "drift" ? m.timeLimitMs : null, timeLeftAt: Date.now(),
      });
      R.getState().pushFeed(m.rounds > 1 ? `${m.name} – round ${m.round}/${m.rounds}` : m.name, "info");
    };
    const onGo = () => R.setState({ phase: "running" });
    const onStandings = (m: { standings: any[]; timeLeftMs: number | null }) => {
      const me = m.standings.find((x) => x.id === useNet.getState().selfId);
      const gates = me?.gates ?? 0;
      R.setState((st) => ({ standings: m.standings, myGates: gates, nextGate: targetGate(gates), timeLeftMs: m.timeLeftMs, timeLeftAt: Date.now(), phase: st.phase === "countdown" && Date.now() >= st.startLocal ? "running" : st.phase }));
    };
    const onEvent = (e: { type: string; id: string; name: string; lap?: number; lapMs?: number; position?: number; timeMs?: number }) => {
      const me = e.id === useNet.getState().selfId, who = me ? "You" : e.name;
      const push = R.getState().pushFeed;
      if (e.type === "lap") push(`${who}: lap ${e.lap} · ${fmt(e.lapMs ?? 0)}`, me ? "good" : "info");
      else if (e.type === "finish") push(`${who} finished #${e.position} · ${fmt(e.timeMs ?? 0)}`, me ? "good" : "info");
      else if (e.type === "eliminated") push(`${who} ${me ? "were" : "was"} eliminated`, "bad");
      else if (e.type === "timeup") push(me ? "Time's up!" : `${e.name}: time's up`, me ? "bad" : "info");
    };
    const onResults = (r: RaceResults) => R.setState({ phase: "results", results: r, nextAtLocal: r.next ? Date.now() + r.next.inMs : null });
    const onAborted = (m: { reason: string }) => { R.setState({ phase: "idle", info: null, standings: [], results: null }); R.getState().pushFeed(m.reason, "bad"); };

    s.on("race:countdown", onCountdown); s.on("race:go", onGo); s.on("race:standings", onStandings);
    s.on("race:event", onEvent); s.on("race:results", onResults); s.on("race:aborted", onAborted);
    return () => {
      s.off("race:countdown", onCountdown); s.off("race:go", onGo); s.off("race:standings", onStandings);
      s.off("race:event", onEvent); s.off("race:results", onResults); s.off("race:aborted", onAborted);
      R.getState().reset();
    };
  }, [enabled]);
}

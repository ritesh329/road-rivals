"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, post, type InvitePreview, type Me, type RoomView } from "@/services/api";

/** Landing page of an invite link: shows who invited you, then joins THAT room (the token decides, never a guess). */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState(""); const [joining, setJoining] = useState(false);
  const started = useRef(false);
  const preview = useQuery({ queryKey: ["invite", token], queryFn: () => api<InvitePreview>(`/rooms/invite/${token}`) });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const loggedOut = me.error instanceof ApiError && me.error.status === 401;

  async function join() {
    if (joining) return; setJoining(true); setError("");
    try { const r = await post<{ room: RoomView }>("/rooms/join", { token }); router.replace(`/room/${r.room.code}`); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Network error"); setJoining(false); }
  }
  useEffect(() => { if (me.data && preview.data?.joinable && !started.current) { started.current = true; void join(); } }, [me.data, preview.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = encodeURIComponent(`/join/${token}`);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-4 text-center" data-testid="join-card">
        <h1 className="font-display text-2xl font-black">ROOM <span className="text-rival">INVITE</span></h1>
        {preview.isLoading && <p className="text-slate-400">Checking invite…</p>}
        {preview.error && <p className="text-red-300" data-testid="invite-error">{(preview.error as Error).message}</p>}
        {preview.data && (
          <>
            <p className="text-lg"><b>{preview.data.host}</b> invited you to race</p>
            <p className="text-sm text-slate-400">{preview.data.players}/{preview.data.maxPlayers} players · {preview.data.status === "RACING" ? "session in progress" : "in the lobby"}</p>
            {preview.data.reason && <p className="text-amber-300">{preview.data.reason}</p>}
            {loggedOut ? (
              <div className="flex gap-2"><Link className="btn btn-primary flex-1" href={`/login?next=${next}`}>Login to join</Link><Link className="btn btn-ghost flex-1" href={`/register?next=${next}`}>Create account</Link></div>
            ) : (
              <button data-testid="join-invite" disabled={joining || !preview.data.joinable} className="btn btn-primary w-full" onClick={join}>{joining ? "Joining…" : "Join room"}</button>
            )}
          </>
        )}
        {error && <p className="text-red-300" data-testid="join-error">{error}</p>}
        <Link href="/rooms" className="block text-xs text-slate-500">Go to multiplayer</Link>
      </div>
    </main>
  );
}

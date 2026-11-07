import Link from "next/link";
export default function Landing() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(244,63,94,.25),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(34,211,238,.18),transparent_60%)]" />
      <p className="font-display text-sm tracking-[0.4em] text-neon">BROWSER · 3D · MULTIPLAYER</p>
      <h1 className="font-display mt-4 text-5xl font-black sm:text-7xl">ROAD <span className="text-rival">RIVALS</span></h1>
      <p className="mt-6 max-w-xl text-slate-400">Race up to five friends in an open-world city. Earn coins, upgrade real engine physics, repair at garages. No install — just your browser.</p>
      <div className="mt-10 flex gap-4">
        <Link href="/register" className="btn btn-primary">Start Racing</Link>
        <Link href="/login" className="btn btn-ghost">Login</Link>
      </div>
    </main>
  );
}

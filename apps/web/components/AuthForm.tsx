"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/services/api";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next && next.startsWith("/") ? next : "/dashboard");
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4">
        <h1 className="font-display text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your driver"}</h1>
        <input className="input" type="email" placeholder="Email" required value={form.email} onChange={set("email")} />
        {mode === "register" && <input className="input" placeholder="Username" required minLength={3} maxLength={20} value={form.username} onChange={set("username")} />}
        <input className="input" type="password" placeholder="Password (min 8)" required minLength={mode === "register" ? 8 : 1} value={form.password} onChange={set("password")} />
        {error && <p className="text-sm text-rival">{error}</p>}
        <button className="btn btn-primary w-full" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Login" : "Register"}</button>
        <p className="text-center text-sm text-slate-400">
          {mode === "login" ? <>New here? <Link className="text-neon" href="/register">Register</Link></> : <>Have an account? <Link className="text-neon" href="/login">Login</Link></>}
        </p>
      </form>
    </main>
  );
}

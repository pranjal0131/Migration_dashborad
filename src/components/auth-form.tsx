"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/auth/${mode}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(values) });
    const data = await response.json(); setLoading(false);
    if (!response.ok) return setError(data.error ?? "Request failed");
    router.push("/dashboard"); router.refresh();
  }
  return <div className="auth-wrap"><div className="card auth-card">
    <div className="brand"><span>Migration</span> Monitor</div>
    <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
    <p>{mode === "login" ? "Sign in to view your migration audits." : "Start monitoring your website migrations."}</p>
    <form onSubmit={submit}>
      {mode === "register" && <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" required minLength={2}/></div>}
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required/></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" required minLength={mode === "register" ? 8 : 1}/></div>
      {error && <div className="error">{error}</div>}
      <button className="button" disabled={loading}>{loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    <div className="auth-foot">{mode === "login" ? <>New here? <Link href="/register">Create an account</Link></> : <>Already registered? <Link href="/login">Sign in</Link></>}</div>
  </div></div>;
}

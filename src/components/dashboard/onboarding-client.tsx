"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Screen = "form" | "sending" | "sent";

export function OnboardingClient() {
  const [email, setEmail] = useState("");
  const [screen, setScreen] = useState<Screen>("form");
  const [error, setError] = useState("");
  const [devMagicLink, setDevMagicLink] = useState("");
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const sendMagicLink = async () => {
    if (!isValid) return;
    setScreen("sending");
    setError("");
    const response = await fetch("/api/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to send a magic link."); setScreen("form"); return; }
    setDevMagicLink(data.devMagicLink ?? "");
    setScreen("sent");
  };

  return <main className="min-h-screen overflow-x-hidden bg-[#f7f9fc] text-slate-950">
    <header className="border-b border-slate-200 bg-white/85 backdrop-blur"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4"><Link href="/" className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-950 text-white"><ShieldCheck className="size-5" /></span><div><p className="font-semibold tracking-tight">Privacy Lens</p><p className="text-xs text-slate-500">Exposure intelligence</p></div></Link><Badge variant="outline" className="hidden border-emerald-200 bg-emerald-50 text-emerald-700 sm:inline-flex"><LockKeyhole />Private by design</Badge></div></header>
    <div className="mx-auto grid max-w-5xl min-w-0 grid-cols-1 gap-8 px-5 py-10 lg:grid-cols-[.85fr_1.15fr] lg:py-20"><aside className="min-w-0 lg:pt-9"><Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-950"><ArrowLeft className="size-4" />Back to home</Link><p className="mt-9 text-sm font-semibold text-blue-600">SECURE SIGN-IN</p><h1 className="mt-2 break-words text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">Start with proof that it&apos;s you.</h1><p className="mt-4 max-w-md break-words leading-7 text-slate-600">There are no passwords to remember. We send a one-time sign-in link to the email address you control.</p><div className="mt-8 space-y-3 text-sm text-slate-600"><p className="flex items-center gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">1</span>Request a secure magic link</p><p className="flex items-center gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">2</span>Open the link in your email</p><p className="flex items-center gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">3</span>Verify identifiers before scanning</p></div></aside>
      <Card className="h-fit w-full min-w-0 self-start border-slate-200 shadow-xl shadow-slate-200/50 lg:mt-24"><CardHeader><CardTitle>{screen === "sent" ? "Check your inbox" : "Sign in to Privacy Lens"}</CardTitle><CardDescription>{screen === "sent" ? "Your secure sign-in link is on its way." : "Use your email to sign in or create a privacy workspace."}</CardDescription></CardHeader><CardContent>
        {screen === "form" && <><label className="text-sm font-medium" htmlFor="email">Email address</label><div className="relative mt-2"><Mail className="absolute left-3 top-3 size-5 text-slate-400" /><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></div>{error && <p className="mt-3 text-sm text-red-600">{error}</p>}<Button className="mt-5 w-full" disabled={!isValid} onClick={sendMagicLink}><Mail />Email me a magic link</Button></>}
        {screen === "sending" && <div className="flex min-h-52 flex-col items-center justify-center text-center"><span className="size-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" /><p className="mt-5 font-medium">Sending your secure link...</p><p className="mt-1 text-sm text-slate-500">This usually takes a moment.</p></div>}
        {screen === "sent" && <div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100"><CheckCircle2 className="size-7 text-emerald-700" /></span><p className="mt-5 text-lg font-semibold">Magic link sent</p><p className="mt-2 text-sm leading-6 text-slate-600">We sent a sign-in link to <span className="font-medium text-slate-800">{email}</span>. Open it to continue securely.</p>{devMagicLink && <a href={devMagicLink} className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">Continue with local magic link</a>}<div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-3 text-left text-sm leading-6 text-blue-900">Once signed in, you&apos;ll verify any identifier you want us to scan with a separate 6-digit ownership code.</div><Button variant="outline" className="mt-5 w-full" onClick={() => setScreen("form")}>Use a different email</Button></div>}
      </CardContent></Card>
    </div>
  </main>;
}

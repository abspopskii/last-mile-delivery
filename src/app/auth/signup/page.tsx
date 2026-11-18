"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { ArrowRight, Route } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/firebase";

function setSessionCookie(token: string) {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `sr_session=${encodeURIComponent(token)}; path=/; expires=${expires}; SameSite=Lax`;
}

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      setSessionCookie(await credential.user.getIdToken());
      router.push("/company/register");
    } catch (err: unknown) {
      const code = typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "";
      if (code === "auth/email-already-in-use") {
        setError("An account with this email already exists. Sign in instead.");
      } else if (code === "auth/weak-password") {
        setError("Password must be at least 8 characters.");
      } else if (code === "auth/network-request-failed") {
        setError("Network error. Check your internet connection and try again.");
      } else if (code === "auth/operation-not-allowed") {
        setError("Email/password sign-up is not enabled in Firebase.");
      } else if (code === "auth/invalid-api-key" || code === "auth/app-not-initialized") {
        setError("Authentication is not configured. Check the Firebase environment settings.");
      } else {
        setError(`Could not create your account${code ? ` (${code})` : ""}. Please try again.`);
      }
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#080B0F] text-[#F1F3F5] flex items-center justify-center px-5 py-12">
      <section className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2.5 mb-10">
          <span className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Route className="w-4 h-4 text-amber-500" />
          </span>
          <span className="font-bold tracking-tight">SentinelRoute</span>
        </Link>

        <h1 className="text-2xl font-bold mb-2">Create your account</h1>
        <p className="text-sm text-slate-400 mb-8">
          Start managing your Nigerian logistics operations.
        </p>

        {error && (
          <div role="alert" className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="signup-email" className="text-xs text-slate-400">Email</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="h-11 bg-[#0D1218] border-[#202A33] text-[#F1F3F5]"
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="signup-password" className="text-xs text-slate-400">Password</Label>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="h-11 bg-[#0D1218] border-[#202A33] text-[#F1F3F5]"
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full h-11 gap-2" disabled={loading}>
            {loading ? "Creating account..." : <>Continue <ArrowRight className="w-4 h-4" /></>}
          </Button>
        </form>

        <p className="text-sm text-slate-400 mt-6 text-center">
          Already have an account?{" "}
          <Link href="/auth/signin" className="text-amber-400 hover:text-amber-300 underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}

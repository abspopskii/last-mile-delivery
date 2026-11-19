"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Route } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";
import { useUser } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano",
  "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
  "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
  "Yobe", "Zamfara",
];

const OPERATIONS = [
  "3PL Provider",
  "E-Commerce Fulfillment",
  "Freight & Cargo",
  "Cold Chain Logistics",
  "FMCG Distribution",
  "Other",
];

export default function CompanyRegisterPage() {
  const router = useRouter();
  const { user } = useUser();
  const { refresh } = useCompany();
  const [companyName, setCompanyName] = useState("");
  const [operation, setOperation] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!user) {
      setError("Your account is still loading. Refresh the page and try again.");
      return;
    }
    if (!companyName.trim() || !operation || !state) {
      setError("Enter your company name, operation, and state.");
      return;
    }

    setSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetchApi("/api/company/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyName: companyName.trim(),
          companyType: operation,
          operatingStates: [state],
          email: user.email ?? "",
          contactName: user.displayName ?? user.email ?? "",
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Could not register your company. Please try again.");
        return;
      }

      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      console.error("[company-register]", err);
      const detail = process.env.NODE_ENV === "development" && err instanceof Error
        ? ` (${err.message})`
        : "";
      setError(`Could not register your company. Check your connection and try again.${detail}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <section className="mx-auto w-full max-w-lg">
        <Link href="/" className="mb-10 inline-flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
            <Route className="h-4 w-4 text-amber-500" />
          </span>
          <span className="font-bold tracking-tight">SentinelRoute</span>
        </Link>

        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Quick setup</p>
        <h1 className="text-2xl font-bold">Set up your workspace</h1>
        <p className="mb-8 mt-2 text-sm text-muted-foreground">
          Just add your company, operation, and state. No verification documents are needed for this presentation.
        </p>

        {error && (
          <div role="alert" className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-border bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              autoComplete="organization"
              required
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="e.g. Lagos Express"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="company-operation">Operation</Label>
            <select
              id="company-operation"
              required
              value={operation}
              onChange={(event) => setOperation(event.target.value)}
              disabled={saving}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Select an operation</option>
              {OPERATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="operating-state">Operating state</Label>
            <select
              id="operating-state"
              required
              value={state}
              onChange={(event) => setState(event.target.value)}
              disabled={saving}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Select a state</option>
              {NIGERIAN_STATES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <Button type="submit" className="h-11 w-full gap-2" disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Setting up...</> : <>Open workspace <ArrowRight className="h-4 w-4" /></>}
          </Button>
        </form>
      </section>
    </main>
  );
}

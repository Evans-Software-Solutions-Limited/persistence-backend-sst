import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink, supabaseConfig } from "../adminAuth";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const configured = supabaseConfig() !== null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await sendMagicLink(
        email.trim(),
        `${window.location.origin}/admin/callback`,
      );
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setState("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">Persistence admin</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with a magic link.
          </p>
        </div>
        {!configured ? (
          <p role="alert" className="text-sm text-destructive">
            Admin sign-in isn't configured for this site (missing Supabase URL /
            key).
          </p>
        ) : null}
        {state === "sent" ? (
          <p className="text-sm">
            Check <strong>{email}</strong> for a sign-in link. Open it on this
            device.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!configured || state === "sending"}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={!configured || state === "sending"}
            >
              {state === "sending" ? "Sending…" : "Send sign-in link"}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}

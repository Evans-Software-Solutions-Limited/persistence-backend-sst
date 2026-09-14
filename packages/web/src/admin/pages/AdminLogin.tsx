import { useState, type FormEvent } from "react";
import { IconArrowRight, IconMail, IconShieldLock } from "@tabler/icons-react";
import { AdminBrand } from "../AdminBrand";
import "../admin.css";
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
    <main className="persistence-admin admin-login">
      <div className="admin-login-intro">
        <AdminBrand />
        <div className="admin-login-heading">
          <span className="admin-eyebrow">Behind every stronger day</span>
          <h1>
            Your community.
            <br />
            <span>Moving forward.</span>
          </h1>
          <p>
            One workspace to manage member access, referrals and the growth of
            Persistence.
          </p>
        </div>
        <span className="admin-login-signature">
          Built for consistency. Managed with care.
        </span>
      </div>
      <form onSubmit={onSubmit} className="admin-login-form">
        <div>
          <IconShieldLock
            className="admin-login-icon"
            size={26}
            stroke={1.5}
            aria-hidden="true"
          />
          <h2>Welcome back</h2>
          <p className="text-sm text-muted-foreground">
            Sign in to your admin workspace with a secure email link.
          </p>
        </div>
        {!configured ? (
          <p role="alert" className="text-sm text-destructive">
            Admin sign-in isn't configured for this site (missing Supabase URL /
            key).
          </p>
        ) : null}
        {state === "sent" ? (
          <p className="admin-login-sent" role="status">
            <IconMail size={24} aria-hidden="true" />
            Check <strong>{email}</strong> for a sign-in link. Open it on this
            device.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Admin email</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="you@company.com"
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
              <IconArrowRight size={18} aria-hidden="true" />
            </Button>
          </>
        )}
        <p className="admin-login-note">
          For authorised Persistence administrators.
        </p>
      </form>
    </main>
  );
}

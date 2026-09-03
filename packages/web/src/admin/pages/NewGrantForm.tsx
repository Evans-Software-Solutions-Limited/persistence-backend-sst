import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminApiError,
  adminApi,
  formatDate,
  formatMinor,
  type FoundingTierName,
  type GrantResult,
  type NewGrantInput,
  type PaymentMethod,
} from "../adminApi";
import { ErrorState, selectClass } from "../ui";

/**
 * The at-the-stand flow (Brad, 2026-09-03): email → tier → payment → Grant.
 * Live lookup on the email shows whether the account exists (so we know if
 * this becomes an ACTIVE grant or a PENDING one applied at sign-up), its role
 * (coach → consumer-tier demotion warning), and any existing subscription.
 */

const METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  stripe_link: "Stripe payment link",
  card_in_person: "Card in person",
  other: "Other",
};

const COACH_ROLES = new Set(["personal_trainer", "physiotherapist"]);
const CONSUMER_TIERS = new Set<FoundingTierName>(["premium", "premium_plus"]);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function NewGrantForm({
  onDone,
}: {
  onDone?: (result: GrantResult) => void;
}) {
  const qc = useQueryClient();
  const catalogue = useQuery({
    queryKey: ["admin", "catalogue"],
    queryFn: adminApi.catalogue,
    staleTime: Infinity,
  });

  const [email, setEmail] = useState("");
  const [tierName, setTierName] = useState<FoundingTierName>("premium");
  // Amount shows the tier's list price until the admin edits it.
  const [amountOverride, setAmountOverride] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("card_in_person");
  const [paymentReference, setPaymentReference] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [referralCode, setReferralCode] = useState("");
  const [notes, setNotes] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [allowRoleChange, setAllowRoleChange] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<GrantResult | null>(null);

  const offer = catalogue.data?.offers[tierName];
  const amount =
    amountOverride ?? (offer ? (offer.priceMinor / 100).toFixed(2) : "");

  const debouncedEmail = useDebounced(email.trim().toLowerCase(), 400);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debouncedEmail);
  const lookup = useQuery({
    queryKey: ["admin", "lookup", debouncedEmail],
    queryFn: () => adminApi.lookupUser(debouncedEmail),
    enabled: emailValid,
    staleTime: 10_000,
  });

  const account = lookup.data?.account ?? null;
  const isCoach = account ? COACH_ROLES.has(account.role ?? "") : false;
  const demotionRisk = isCoach && CONSUMER_TIERS.has(tierName);
  const alreadyHasGrant =
    (account?.foundingGrants.some((g) => !g.revokedAt) ?? false) ||
    (lookup.data?.pendingGrants.length ?? 0) > 0;

  const create = useMutation({
    mutationFn: (input: NewGrantInput) => adminApi.createGrant(input),
    onSuccess: (res) => {
      setResult(res);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["admin"] });
      onDone?.(res);
    },
  });

  const amountMinor = useMemo(
    () => Math.round(Number.parseFloat(amount || "0") * 100),
    [amount],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirming) return setConfirming(true);
    create.mutate({
      email: email.trim().toLowerCase(),
      tierName,
      amountMinor: Number.isFinite(amountMinor) ? amountMinor : undefined,
      paymentMethod,
      paymentReference: paymentReference.trim() || null,
      paidAt: paidAt
        ? new Date(`${paidAt}T12:00:00Z`).toISOString()
        : undefined,
      referralCode: referralCode.trim() || null,
      notes: notes.trim() || null,
      allowRoleChange,
      sendInvite,
    });
  }

  function reset() {
    setEmail("");
    setAmountOverride(null);
    setPaymentReference("");
    setReferralCode("");
    setNotes("");
    setAllowRoleChange(false);
    setConfirming(false);
    setResult(null);
    create.reset();
  }

  if (result) {
    return (
      <div
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        role="status"
      >
        <h2 className="text-base font-semibold">
          {result.status === "active"
            ? "Granted — access is live"
            : "Granted — applies when they sign up"}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{result.email}</dd>
          <dt className="text-muted-foreground">Tier</dt>
          <dd>
            {catalogue.data?.offers[result.tierName]?.label ?? result.tierName}
          </dd>
          <dt className="text-muted-foreground">Access until</dt>
          <dd>
            {result.expiresAt
              ? formatDate(result.expiresAt)
              : "6 months from their first sign-in"}
          </dd>
          <dt className="text-muted-foreground">Invite email</dt>
          <dd>
            {result.invited
              ? "sent"
              : `not sent${result.inviteError ? ` — ${result.inviteError}` : ""}`}
          </dd>
          <dt className="text-muted-foreground">Places left</dt>
          <dd className="tabular-nums">
            {result.seats.cap - result.seats.used} of {result.seats.cap}
          </dd>
          {result.referral ? (
            <>
              <dt className="text-muted-foreground">Attributed to</dt>
              <dd>
                {result.referral.label} ({result.referral.code})
              </dd>
            </>
          ) : null}
        </dl>
        {result.status === "pending" ? (
          <p className="text-xs text-muted-foreground">
            Tell them: download the app and sign up with{" "}
            <strong>{result.email}</strong> — nothing to enter.
          </p>
        ) : null}
        <Button onClick={reset}>Next person</Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label="New founding grant"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="grant-email">
            Their email (the one they'll use in the app)
          </Label>
          <Input
            id="grant-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setConfirming(false);
            }}
          />
          <p
            className="min-h-4 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {!emailValid
              ? ""
              : lookup.isPending
                ? "Checking…"
                : account
                  ? `Account exists (${account.role ?? "user"})${
                      account.subscription
                        ? ` · currently ${account.subscription.tierName}`
                        : ""
                    }${account.attribution ? ` · referral ${account.attribution.code}` : ""} — access switches on immediately.`
                  : "No account yet — they'll get access the moment they sign up with this email."}
          </p>
          {alreadyHasGrant ? (
            <p role="alert" className="text-xs text-destructive">
              This email already has a live founding grant.
            </p>
          ) : null}
        </div>

        <fieldset className="space-y-1.5 sm:col-span-2">
          <legend className="text-sm font-medium">Tier</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              Object.keys(catalogue.data?.offers ?? {}) as FoundingTierName[]
            ).map((t) => {
              const o = catalogue.data!.offers[t];
              const active = t === tierName;
              return (
                <label
                  key={t}
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={t}
                    checked={active}
                    onChange={() => {
                      setTierName(t);
                      setConfirming(false);
                    }}
                    className="sr-only"
                  />
                  <div className="font-medium">{o.label}</div>
                  <div className="text-muted-foreground">
                    {formatMinor(o.priceMinor)} · {o.months} months
                  </div>
                </label>
              );
            })}
          </div>
          {demotionRisk ? (
            <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
              <input
                type="checkbox"
                checked={allowRoleChange}
                onChange={(e) => setAllowRoleChange(e.target.checked)}
              />
              <span>
                This is a coach account. A consumer tier switches it to a
                regular user and it loses coach mode. Tick to do it anyway, or
                pick Start Up Coach+.
              </span>
            </label>
          ) : null}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="grant-amount">Amount paid (£)</Label>
          <Input
            id="grant-amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmountOverride(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-method">Paid by</Label>
          <select
            id="grant-method"
            className={selectClass}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            {(
              catalogue.data?.paymentMethods ??
              (Object.keys(METHOD_LABEL) as PaymentMethod[])
            ).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-ref">Payment reference (optional)</Label>
          <Input
            id="grant-ref"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            placeholder="Bank ref / Stripe id"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-paid">Paid on</Label>
          <Input
            id="grant-paid"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-code">Referral / vendor code (optional)</Label>
          <Input
            id="grant-code"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="Which stand or partner sent them"
            autoCapitalize="characters"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-notes">Notes (optional)</Label>
          <Textarea
            id="grant-notes"
            rows={1}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
          />
          Send them the founding-member email now
        </label>
      </div>

      {create.isError ? (
        <ErrorState
          error={
            create.error instanceof AdminApiError &&
            create.error.body?.code === "coach_demotion"
              ? new Error(
                  "Coach account — tick the role-change box or choose a coach tier.",
                )
              : create.error
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={
            create.isPending ||
            !catalogue.data ||
            alreadyHasGrant ||
            (demotionRisk && !allowRoleChange)
          }
        >
          {create.isPending
            ? "Granting…"
            : confirming
              ? `Confirm: ${offer?.label ?? tierName} for ${email.trim() || "…"} — ${formatMinor(Number.isFinite(amountMinor) ? amountMinor : 0)}`
              : "Grant"}
        </Button>
        {confirming ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            Back
          </Button>
        ) : null}
      </div>
    </form>
  );
}

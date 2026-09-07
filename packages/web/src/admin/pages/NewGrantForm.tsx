import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  adminApi,
  formatDate,
  formatMinor,
  todayIsoDay,
  type FoundingTierName,
  type GrantResult,
  type NewGrantInput,
  type PaymentMethod,
} from "../adminApi";
import { ErrorState, selectClass } from "../ui";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  stripe_link: "Stripe payment link",
  card_in_person: "Card in person",
  other: "Other",
};
const COACH_ROLES = new Set(["personal_trainer", "physiotherapist"]);
const CONSUMER_TIERS = new Set<FoundingTierName>(["premium", "premium_plus"]);

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
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
  });
  const [email, setEmail] = useState("");
  const [tierName, setTierName] = useState<FoundingTierName>("premium");
  const [grantKind, setGrantKind] = useState<"founding" | "complimentary">(
    "founding",
  );
  const [months, setMonths] = useState(6);
  const [hasContribution, setHasContribution] = useState(false);
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionMethod, setContributionMethod] =
    useState<PaymentMethod>("other");
  const [contributionReference, setContributionReference] = useState("");
  const [contributedAt, setContributedAt] = useState(todayIsoDay);
  const [referralCode, setReferralCode] = useState("");
  const [notes, setNotes] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [allowRoleChange, setAllowRoleChange] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<GrantResult | null>(null);

  const debouncedEmail = useDebounced(email.trim().toLowerCase(), 400);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debouncedEmail);
  const lookup = useQuery({
    queryKey: ["admin", "lookup", debouncedEmail],
    queryFn: () => adminApi.lookupUser(debouncedEmail),
    enabled: emailValid,
    staleTime: 10_000,
  });
  const account = lookup.data?.account ?? null;
  const demotionRisk =
    !!account &&
    COACH_ROLES.has(account.role ?? "") &&
    CONSUMER_TIERS.has(tierName);
  const storeSubscriptionRisk = account?.subscription?.fromStore === true;
  const alreadyHasGrant =
    (account?.foundingGrants.some((grant) => !grant.revokedAt) ?? false) ||
    (lookup.data?.pendingGrants.length ?? 0) > 0;
  const contributionAmountMinor = useMemo(
    () => Math.round(Number.parseFloat(contributionAmount || "0") * 100),
    [contributionAmount],
  );
  const contributionReferenceRequired =
    hasContribution &&
    (contributionMethod === "bank_transfer" ||
      contributionMethod === "stripe_link");

  const create = useMutation({
    mutationFn: (input: NewGrantInput) => adminApi.createGrant(input),
    onSuccess: (value) => {
      setResult(value);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["admin"] });
      onDone?.(value);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirming) return setConfirming(true);
    create.mutate({
      email: email.trim().toLowerCase(),
      tierName,
      grantKind,
      months,
      ...(hasContribution
        ? {
            contributionAmountMinor,
            contributionCurrency: "GBP",
            contributionMethod,
            contributionReference: contributionReference.trim() || null,
            contributedAt: new Date(`${contributedAt}T12:00:00Z`).toISOString(),
          }
        : {}),
      referralCode: referralCode.trim() || null,
      notes: notes.trim() || null,
      allowRoleChange,
      sendInvite,
    });
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
          <dt className="text-muted-foreground">Grant</dt>
          <dd>
            {result.grantKind === "founding"
              ? "Founding place"
              : "Complimentary"}
          </dd>
          <dt className="text-muted-foreground">Tier</dt>
          <dd>
            {catalogue.data?.offers[result.tierName]?.label ?? result.tierName}
          </dd>
          <dt className="text-muted-foreground">Duration</dt>
          <dd>{result.months} months</dd>
          <dt className="text-muted-foreground">Access until</dt>
          <dd>
            {result.expiresAt
              ? formatDate(result.expiresAt)
              : `${result.months} months from first sign-in`}
          </dd>
          {result.seats ? (
            <>
              <dt className="text-muted-foreground">Founding places left</dt>
              <dd>
                {result.seats.cap - result.seats.used} of {result.seats.cap}
              </dd>
            </>
          ) : null}
        </dl>
        <Button onClick={() => setResult(null)}>Next person</Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label="New access grant"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="grant-email">Recipient email used in the app</Label>
          <Input
            id="grant-email"
            type="email"
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
                  ? `Account exists${account.subscription ? ` · currently ${account.subscription.tierName}` : ""}. Access switches on immediately.`
                  : "No account yet — access applies when they sign up with this email."}
          </p>
          {alreadyHasGrant ? (
            <p role="alert" className="text-xs text-destructive">
              This email already has a live grant. Extend it from the grants
              table instead.
            </p>
          ) : null}
        </div>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">Grant type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="rounded-lg border border-border p-3 text-sm">
              <input
                type="radio"
                name="kind"
                checked={grantKind === "founding"}
                onChange={() => setGrantKind("founding")}
              />{" "}
              <strong>Founding place</strong>
              <span className="block text-muted-foreground">
                Counts against campaign capacity.
              </span>
            </label>
            <label className="rounded-lg border border-border p-3 text-sm">
              <input
                type="radio"
                name="kind"
                checked={grantKind === "complimentary"}
                onChange={() => setGrantKind("complimentary")}
              />{" "}
              <strong>Complimentary</strong>
              <span className="block text-muted-foreground">
                Free access; no founding place used.
              </span>
            </label>
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="grant-tier">Tier</Label>
          <select
            id="grant-tier"
            className={selectClass}
            value={tierName}
            onChange={(e) => {
              const tier = e.target.value as FoundingTierName;
              setTierName(tier);
              setMonths(catalogue.data?.offers[tier]?.months ?? 6);
            }}
          >
            {(
              Object.keys(catalogue.data?.offers ?? {}) as FoundingTierName[]
            ).map((tier) => (
              <option key={tier} value={tier}>
                {catalogue.data!.offers[tier].label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-months">Access length (months)</Label>
          <Input
            id="grant-months"
            type="number"
            min="1"
            max="120"
            required
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          />
        </div>

        {demotionRisk ? (
          <label className="sm:col-span-2 text-xs">
            <input
              type="checkbox"
              checked={allowRoleChange}
              onChange={(e) => setAllowRoleChange(e.target.checked)}
            />{" "}
            This consumer tier changes the coach account role. Continue anyway.
          </label>
        ) : null}
        {storeSubscriptionRisk ? (
          <p className="sm:col-span-2 text-xs text-destructive">
            This account has live App Store or Play Store access. It cannot be
            displaced by an admin grant; grant access after it expires.
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={hasContribution}
            onChange={(e) => setHasContribution(e.target.checked)}
          />{" "}
          Record a separate crowdfunding contribution
        </label>
        {hasContribution ? (
          <>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Optional accounting evidence only. It does not buy, determine, or
              extend access.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="contribution-amount">Contribution (£)</Label>
              <Input
                id="contribution-amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={contributionAmount}
                onChange={(e) => setContributionAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contribution-method">Method</Label>
              <select
                id="contribution-method"
                className={selectClass}
                value={contributionMethod}
                onChange={(e) =>
                  setContributionMethod(e.target.value as PaymentMethod)
                }
              >
                {(
                  catalogue.data?.contributionMethods ??
                  (Object.keys(METHOD_LABEL) as PaymentMethod[])
                ).map((method) => (
                  <option key={method} value={method}>
                    {METHOD_LABEL[method]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contribution-ref">
                Reference (
                {contributionReferenceRequired ? "required" : "optional"})
              </Label>
              <Input
                id="contribution-ref"
                required={contributionReferenceRequired}
                value={contributionReference}
                onChange={(e) => setContributionReference(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contributed-at">Contribution date</Label>
              <Input
                id="contributed-at"
                type="date"
                required
                value={contributedAt}
                onChange={(e) => setContributedAt(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="grant-code">Referral code (optional)</Label>
          <Input
            id="grant-code"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
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
          />{" "}
          Send the access email now
        </label>
      </div>

      {create.isError ? <ErrorState error={create.error} /> : null}
      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={
            create.isPending ||
            !catalogue.data ||
            alreadyHasGrant ||
            !Number.isInteger(months) ||
            months < 1 ||
            months > 120 ||
            (demotionRisk && !allowRoleChange) ||
            storeSubscriptionRisk
          }
        >
          {create.isPending
            ? "Granting…"
            : confirming
              ? `Confirm ${grantKind} ${catalogue.data?.offers[tierName]?.label ?? tierName} for ${months} months`
              : "Grant access"}
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
      {hasContribution &&
      Number.isFinite(contributionAmountMinor) &&
      contributionAmountMinor > 0 ? (
        <p className="text-xs text-muted-foreground">
          Separate contribution recorded: {formatMinor(contributionAmountMinor)}
        </p>
      ) : null}
    </form>
  );
}

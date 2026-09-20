import {
  GRANTABLE_TIERS,
  type GrantableTierId,
} from "@persistence/subscription-catalog";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  adminApi,
  formatDate,
  formatMinor,
  type GrantRow,
  type FoundingTierName,
} from "../adminApi";
import { ErrorState, Panel, selectClass } from "../ui";

interface Props {
  grant: GrantRow;
  onClose: () => void;
}

export function ChangeGrantTierForm({ grant, onClose }: Props) {
  const qc = useQueryClient();
  const catalogue = useQuery({
    queryKey: ["admin", "catalogue"],
    queryFn: adminApi.catalogue,
  });
  const [tierName, setTierName] = useState<GrantableTierId | "">("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const submitting = useRef(false);
  const change = useMutation({
    mutationFn: (tier: GrantableTierId) =>
      adminApi.changeGrantTier(grant.id, tier, reason.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const currentTier = GRANTABLE_TIERS.find(
    (tier) => tier.id === grant.tierName,
  );
  const offers = catalogue.data?.offers;
  const currentPool = offers?.[grant.tierName as FoundingTierName]?.pool;
  const options = GRANTABLE_TIERS.filter(
    (tier) =>
      tier.id !== grant.tierName &&
      tier.audience === currentTier?.audience &&
      (grant.grantKind === "founding"
        ? !!currentPool &&
          offers?.[tier.id as FoundingTierName]?.pool === currentPool
        : catalogue.data?.grantableTiers?.some(
            (available) => available.tierName === tier.id,
          )),
  );
  const selected = options.find((tier) => tier.id === tierName);
  const valid =
    !!selected && reason.trim().length >= 3 && reason.trim().length <= 500;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !tierName || submitting.current || change.isSuccess) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    submitting.current = true;
    change.mutate(tierName);
  }
  return (
    <Panel title={`Change tier · ${grant.email}`} className="mb-6">
      {change.isSuccess ? (
        <div className="space-y-3" role="status">
          <p>
            Tier changed to {selected?.name}. The original access period and
            payment are unchanged.
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form
          aria-label="Change grant tier"
          onSubmit={submit}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            Current tier: {grant.tierLabel ?? grant.tierName}.{" "}
            {grant.status === "pending"
              ? `${grant.months} months from first sign-in.`
              : `Access until ${formatDate(grant.subscriptionExpiresAt)}.`}{" "}
            Changing tier is free and keeps this access period and founding
            place.
          </p>
          {catalogue.isPending ? (
            <p role="status">Loading available tiers…</p>
          ) : null}
          {catalogue.isError ? <ErrorState error={catalogue.error} /> : null}
          {catalogue.data && options.length === 0 ? (
            <p>No other eligible tiers are available for this grant.</p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="change-grant-tier">New tier</Label>
            <select
              id="change-grant-tier"
              className={selectClass}
              value={tierName}
              disabled={change.isPending}
              required
              onChange={(event) => {
                setTierName(event.target.value as GrantableTierId);
                setConfirming(false);
                change.reset();
              }}
            >
              <option value="">Choose a tier</option>
              {options.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-tier-reason">Reason for tier change</Label>
            <Textarea
              id="change-tier-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={change.isPending}
              onChange={(event) => {
                setReason(event.target.value);
                setConfirming(false);
                change.reset();
              }}
            />
          </div>
          {confirming ? (
            <p className="text-sm">
              Confirm changing {grant.email} from{" "}
              {grant.tierLabel ?? grant.tierName} to {selected?.name} at no
              charge.
            </p>
          ) : null}
          {change.isError ? <ErrorState error={change.error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!valid || change.isPending || catalogue.isError}
            >
              {change.isPending
                ? "Changing tier…"
                : confirming
                  ? `Confirm change to ${selected?.name}`
                  : "Review tier change"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={change.isPending}
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

export function RefundGrantForm({ grant, onClose }: Props) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["admin", "grant-refund", grant.id],
    queryFn: async () => {
      const result = await adminApi.grantRefund(grant.id);
      // Preview reconciliation can finish cancelling access after a lost POST.
      void qc.invalidateQueries({ queryKey: ["admin", "grants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "lookup"] });
      void qc.invalidateQueries({ queryKey: ["admin", "summary"] });
      return result;
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Preserve the submitted reason after a lost response, including before refresh.
  const [attemptReason, setAttemptReason] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const submitting = useRef(false);
  const refund = useMutation({
    mutationFn: (value: string) => adminApi.refundGrant(grant.id, value),
    onSuccess: async (result) => {
      qc.setQueryData(
        ["admin", "grant-refund", grant.id],
        (previous: typeof preview.data) =>
          previous ? { ...previous, refund: result } : previous,
      );
      void qc.invalidateQueries({ queryKey: ["admin", "grants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "summary"] });
      void qc.invalidateQueries({ queryKey: ["admin", "lookup"] });
      const refreshed = await preview.refetch();
      setNeedsRefresh(!refreshed.isSuccess);
    },
    onError: () => {
      setNeedsRefresh(true);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const saved = preview.data?.refund;
  const fixedReason = saved?.reason ?? attemptReason;
  const submittedReason = fixedReason ?? reason.trim();
  const retryable = saved?.status === "requested";
  const canSubmit = !saved || retryable;
  const valid = submittedReason.length >= 3 && submittedReason.length <= 500;
  const amount = preview.data
    ? formatMinor(preview.data.remainingAmountMinor, preview.data.currency)
    : "";
  const busy = refund.isPending || preview.isFetching;
  async function refresh() {
    if (submitting.current) return;
    const result = await preview.refetch();
    if (result.isSuccess) {
      setNeedsRefresh(false);
      refund.reset();
      setConfirming(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !canSubmit ||
      !valid ||
      busy ||
      needsRefresh ||
      preview.isError ||
      !preview.data ||
      (preview.data.remainingAmountMinor <= 0 && !retryable) ||
      submitting.current
    )
      return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    submitting.current = true;
    setAttemptReason(submittedReason);
    refund.mutate(submittedReason);
  }
  return (
    <Panel title={`Refund · ${grant.email}`} className="mb-6">
      <form aria-label="Refund grant" className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-muted-foreground">
          Refund the remaining Stripe payment and cancel this grant’s access
          immediately once Stripe accepts the refund. This cannot be undone
          here.
        </p>
        {preview.isPending ? (
          <p role="status">Loading payment and refund status…</p>
        ) : null}
        {preview.isError ? <ErrorState error={preview.error} /> : null}
        {preview.data && !preview.isFetching && !preview.isError ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt>Original payment</dt>
            <dd>
              {formatMinor(preview.data.amountMinor, preview.data.currency)}
            </dd>
            <dt>Already refunded</dt>
            <dd>
              {formatMinor(
                preview.data.refundedAmountMinor,
                preview.data.currency,
              )}
            </dd>
            <dt>Remaining refund</dt>
            <dd>{amount}</dd>
          </dl>
        ) : null}
        {saved ? (
          <div role="status" className="space-y-1 text-sm">
            <p>
              Refund status: <strong>{saved.status}</strong>
              {saved.refundId ? ` · ${saved.refundId}` : ""}
            </p>
            <p>Reason: {saved.reason}</p>
            {retryable ? (
              <p>
                The request is saved. Retry uses the same reason and does not
                create a separate refund.
              </p>
            ) : saved.status === "failed" || saved.status === "canceled" ? (
              <p>
                Review this refund in Stripe before taking further action.
                Access is not restored automatically.
              </p>
            ) : (
              <p>
                The refund request has been accepted and this grant’s access is
                cancelled. Refresh to check its latest status.
              </p>
            )}
          </div>
        ) : null}
        {canSubmit && preview.data ? (
          <>
            {preview.data.remainingAmountMinor <= 0 && !retryable ? (
              <p>This payment has no refundable amount remaining.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="refund-grant-reason">Reason for refund</Label>
                  <Textarea
                    id="refund-grant-reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={fixedReason ?? reason}
                    disabled={busy || fixedReason !== null}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setConfirming(false);
                    }}
                  />
                </div>
                {confirming ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    Confirm refunding {amount} to {grant.email} and cancelling
                    their {grant.tierLabel ?? grant.tierName} access
                    immediately. The refund goes back through Stripe.
                  </p>
                ) : null}
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!valid || busy || needsRefresh || preview.isError}
                >
                  {refund.isPending
                    ? "Submitting refund…"
                    : confirming
                      ? `${retryable || attemptReason ? "Retry" : "Confirm"} refund ${amount} and cancel access`
                      : "Review refund and cancellation"}
                </Button>
              </>
            )}
          </>
        ) : null}
        {refund.isError ? <ErrorState error={refund.error} /> : null}
        {needsRefresh ? (
          <p role="alert" className="text-sm">
            The response could not confirm completion. Refresh the refund status
            before retrying.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {preview.isFetching ? "Refreshing…" : "Refresh refund status"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={refund.isPending}
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </form>
    </Panel>
  );
}

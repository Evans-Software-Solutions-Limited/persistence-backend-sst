import { useAdminDialogs } from "../useAdminDialogs";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { adminApi, formatDate, formatMinor, type GrantRow } from "../adminApi";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
} from "../ui";
import { NewGrantForm } from "./NewGrantForm";
import { ChangeGrantTierForm, RefundGrantForm } from "./GrantActionForms";

export function AdminGrants() {
  const { prompt } = useAdminDialogs();
  const [params, setParams] = useSearchParams();
  const showNew = params.get("new") === "1";
  const [showRevoked, setShowRevoked] = useState(false);
  const [action, setAction] = useState<{
    kind: "tier" | "refund";
    grant: GrantRow;
  } | null>(null);
  const qc = useQueryClient();
  const grants = useQuery({
    queryKey: ["admin", "grants", showRevoked],
    queryFn: () => adminApi.grants(showRevoked ? undefined : false),
  });
  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.revokeGrant(id, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  const resend = useMutation({
    mutationFn: (id: string) => adminApi.resendInvite(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "grants"] }),
  });
  const extend = useMutation({
    mutationFn: ({
      id,
      months,
      reason,
    }: {
      id: string;
      months: number;
      reason: string;
    }) => adminApi.extendGrant(id, months, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  return (
    <>
      <PageHeader title="Access grants">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showRevoked}
            onChange={(e) => setShowRevoked(e.target.checked)}
          />
          Show revoked
        </label>
        <Button
          variant={showNew ? "outline" : "default"}
          onClick={() => setParams(showNew ? {} : { new: "1" })}
        >
          {showNew ? "Close form" : "New access grant"}
        </Button>
      </PageHeader>

      <p className="admin-page-description">
        Individual grants activate when the recipient signs in or signs up with
        the exact email assigned here. Coach grants activate coaching
        capabilities automatically. For single-use membership codes, use{" "}
        <Link to="/admin/vouchers" className="underline">
          Business vouchers
        </Link>{" "}
        and the{" "}
        <Link
          to="/redeem"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          employee redemption page
        </Link>
        .
      </p>
      {showNew ? (
        <div className="mb-6">
          <NewGrantForm />
        </div>
      ) : null}

      {action?.kind === "tier" ? (
        <ChangeGrantTierForm
          key={action.grant.id}
          grant={action.grant}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action?.kind === "refund" ? (
        <RefundGrantForm
          key={action.grant.id}
          grant={action.grant}
          onClose={() => setAction(null)}
        />
      ) : null}

      {revoke.isError ? <ErrorState error={revoke.error} /> : null}
      {resend.isError ? <ErrorState error={resend.error} /> : null}
      {extend.isError ? <ErrorState error={extend.error} /> : null}

      <Panel>
        {grants.isError ? <ErrorState error={grants.error} /> : null}
        {grants.data && grants.data.length === 0 ? (
          <EmptyState>No grants recorded yet.</EmptyState>
        ) : null}
        {grants.data && grants.data.length > 0 ? (
          <Table
            head={[
              "Email",
              "Tier",
              "Kind",
              "Length",
              "Contribution",
              "Reference",
              "Code",
              "Contributed on",
              "Access until",
              "Status",
              "Invite",
              "",
            ]}
          >
            {grants.data.map((g) => (
              <tr
                key={g.id}
                className={
                  g.status === "account_deleted"
                    ? "text-muted-foreground"
                    : undefined
                }
              >
                <td className="whitespace-nowrap">{g.email}</td>
                <td>{g.tierLabel ?? g.tierName}</td>
                <td>
                  {g.grantKind === "founding" ? "Founding" : "Complimentary"}
                </td>
                <td>{g.months} months</td>
                <td className="tabular-nums">
                  {g.contributionAmountMinor > 0
                    ? formatMinor(
                        g.contributionAmountMinor,
                        g.contributionCurrency,
                      )
                    : "None"}
                </td>
                <td
                  className="max-w-32 truncate"
                  title={g.contributionReference ?? ""}
                >
                  {g.contributionReference ?? "—"}
                </td>
                <td title={g.referralLabel ?? ""}>{g.referralCode ?? "—"}</td>
                <td className="whitespace-nowrap">
                  {formatDate(g.contributedAt)}
                </td>
                <td className="whitespace-nowrap">
                  {g.status === "pending"
                    ? "on sign-up"
                    : g.status === "account_deleted"
                      ? "account deleted"
                      : formatDate(g.subscriptionExpiresAt)}
                </td>
                <td>
                  <StatusBadge status={g.status} />
                </td>
                <td className="whitespace-nowrap">
                  {g.invitedAt ? formatDate(g.invitedAt) : "not sent"}
                </td>
                <td className="whitespace-nowrap">
                  <div className="flex flex-wrap items-center gap-1">
                    {!g.revokedAt &&
                    (g.status === "active" || g.status === "pending") ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!!action}
                        onClick={() => setAction({ kind: "tier", grant: g })}
                      >
                        Change tier
                      </Button>
                    ) : null}
                    {g.contributionMethod === "stripe_checkout" ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!!action}
                        onClick={() => setAction({ kind: "refund", grant: g })}
                      >
                        Refund
                      </Button>
                    ) : null}
                    {g.status === "account_deleted" ? (
                      <span className="text-xs text-muted-foreground">
                        {g.contributionMethod === "stripe_checkout"
                          ? "account deleted"
                          : "no actions"}
                      </span>
                    ) : !g.revokedAt ? (
                      <div className="flex gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={extend.isPending || !!action}
                          onClick={async () => {
                            const rawMonths = await prompt(
                              "How many extra months?",
                              "1",
                            );
                            if (!rawMonths) return;
                            const months = Number(rawMonths);
                            if (
                              !Number.isInteger(months) ||
                              months < 1 ||
                              months > 120
                            )
                              return;
                            const reason = await prompt(
                              `Why extend ${g.email}'s access?`,
                            );
                            if (reason && reason.trim().length >= 3)
                              extend.mutate({
                                id: g.id,
                                months,
                                reason: reason.trim(),
                              });
                          }}
                        >
                          Extend
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={resend.isPending || !!action}
                          onClick={() => resend.mutate(g.id)}
                        >
                          Resend email
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={revoke.isPending || !!action}
                          onClick={async () => {
                            const reason = await prompt(
                              `Revoke ${g.email}'s ${g.tierLabel ?? g.tierName}? Reason:`,
                            );
                            if (reason && reason.trim().length >= 3)
                              revoke.mutate({
                                id: g.id,
                                reason: reason.trim(),
                              });
                          }}
                        >
                          Revoke
                        </Button>
                      </div>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title={g.revokeReason ?? ""}
                      >
                        revoked {formatDate(g.revokedAt)}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Panel>
    </>
  );
}

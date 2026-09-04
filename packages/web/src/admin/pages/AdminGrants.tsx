import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { adminApi, formatDate, formatMinor } from "../adminApi";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
} from "../ui";
import { NewGrantForm } from "./NewGrantForm";

export function AdminGrants() {
  const [params, setParams] = useSearchParams();
  const showNew = params.get("new") === "1";
  const [showRevoked, setShowRevoked] = useState(false);
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

  return (
    <>
      <PageHeader title="Founding grants">
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
          {showNew ? "Close form" : "New grant"}
        </Button>
      </PageHeader>

      {showNew ? (
        <div className="mb-6">
          <NewGrantForm />
        </div>
      ) : null}

      {revoke.isError ? <ErrorState error={revoke.error} /> : null}
      {resend.isError ? <ErrorState error={resend.error} /> : null}

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
              "Paid",
              "Method",
              "Ref",
              "Code",
              "Paid on",
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
                <td className="tabular-nums">
                  {formatMinor(g.amountMinor, g.currency)}
                </td>
                <td>{g.paymentMethod.replace(/_/g, " ")}</td>
                <td
                  className="max-w-32 truncate"
                  title={g.paymentReference ?? ""}
                >
                  {g.paymentReference ?? "—"}
                </td>
                <td title={g.referralLabel ?? ""}>{g.referralCode ?? "—"}</td>
                <td className="whitespace-nowrap">{formatDate(g.paidAt)}</td>
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
                  {g.status === "account_deleted" ? (
                    <span className="text-xs text-muted-foreground">
                      no actions
                    </span>
                  ) : !g.revokedAt ? (
                    <div className="flex gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={resend.isPending}
                        onClick={() => resend.mutate(g.id)}
                      >
                        Resend email
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={revoke.isPending}
                        onClick={() => {
                          const reason = window.prompt(
                            `Revoke ${g.email}'s ${g.tierLabel ?? g.tierName}? Reason:`,
                          );
                          if (reason && reason.trim().length >= 3)
                            revoke.mutate({ id: g.id, reason: reason.trim() });
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
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Panel>
    </>
  );
}

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminApi, formatDate, formatMinor } from "../adminApi";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
} from "../ui";

export function AdminLookup() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const q = useQuery({
    queryKey: ["admin", "lookup", email],
    queryFn: () => adminApi.lookupUser(email),
    enabled: email.length > 3,
  });
  const attribute = useMutation({
    mutationFn: ({
      userId,
      code,
      reason,
    }: {
      userId: string;
      code: string;
      reason: string;
    }) => adminApi.setAttribution(userId, code, reason),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "lookup"] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setEmail(input.trim().toLowerCase());
  }

  const account = q.data?.account;

  return (
    <>
      <PageHeader title="Lookup" />
      <form onSubmit={submit} className="mb-4 flex gap-2">
        <Input
          type="email"
          placeholder="exact email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="max-w-sm"
          aria-label="Email to look up"
        />
        <Button type="submit">Look up</Button>
      </form>
      {q.isError ? <ErrorState error={q.error} /> : null}
      {attribute.isError ? <ErrorState error={attribute.error} /> : null}
      {q.data && !account ? (
        <Panel>
          <EmptyState>
            No account for <strong>{email}</strong>.
            {q.data.pendingGrants.length > 0
              ? ` A pending founding grant (${q.data.pendingGrants[0].tierName}) is waiting for them to sign up.`
              : ""}
          </EmptyState>
          <div className="text-center">
            <Button asChild variant="outline">
              <Link to="/admin/grants?new=1">
                Record a founding grant for them
              </Link>
            </Button>
          </div>
        </Panel>
      ) : null}
      {account ? (
        <div className="space-y-4">
          <Panel title="Account">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{account.email}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{account.role ?? "user"}</dd>
              <dt className="text-muted-foreground">Subscription</dt>
              <dd>
                {account.subscription
                  ? `${account.subscription.tierName} · ${account.subscription.paymentStatus}${
                      account.subscription.expiresAt
                        ? ` · until ${formatDate(account.subscription.expiresAt)}`
                        : ""
                    }`
                  : "free"}
              </dd>
              <dt className="text-muted-foreground">Referral</dt>
              <dd>
                {account.attribution
                  ? `${account.attribution.label} (${account.attribution.code})${account.attribution.lockedAt ? " · locked" : ""}`
                  : "none"}
                {!account.attribution?.lockedAt ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-2"
                    disabled={attribute.isPending}
                    onClick={() => {
                      const code = window.prompt(
                        "Referral code to attribute this user to:",
                      );
                      if (!code) return;
                      const reason = window.prompt(
                        "Reason (goes in the audit log):",
                      );
                      if (reason && reason.trim().length >= 3)
                        attribute.mutate({
                          userId: account.id,
                          code: code.trim(),
                          reason: reason.trim(),
                        });
                    }}
                  >
                    {account.attribution ? "Change" : "Set"}
                  </Button>
                ) : null}
              </dd>
            </dl>
          </Panel>
          <Panel title="Founding grants">
            {account.foundingGrants.length === 0 ? (
              <EmptyState>None.</EmptyState>
            ) : (
              <Table
                head={["Tier", "Paid", "Paid on", "Access until", "Status"]}
              >
                {account.foundingGrants.map((g) => (
                  <tr key={g.id}>
                    <td>{g.tierLabel ?? g.tierName}</td>
                    <td className="tabular-nums">
                      {formatMinor(g.amountMinor, g.currency)}
                    </td>
                    <td>{formatDate(g.paidAt)}</td>
                    <td>{formatDate(g.subscriptionExpiresAt)}</td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}

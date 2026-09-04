import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { adminApi, formatDate, formatMinor } from "../adminApi";
import {
  EmptyState,
  ErrorState,
  Meter,
  PageHeader,
  Panel,
  Stat,
  StatusBadge,
  Table,
} from "../ui";

export function AdminDashboard() {
  const q = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: adminApi.summary,
  });

  return (
    <>
      <PageHeader title="Dashboard">
        <Button asChild>
          <Link to="/admin/grants?new=1">New founding grant</Link>
        </Button>
      </PageHeader>
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Founding places (Premium / Premium+)"
              value={`${q.data.founding.pools.consumer.used} / ${q.data.founding.pools.consumer.cap}`}
              hint={
                <Meter
                  used={q.data.founding.pools.consumer.used}
                  cap={q.data.founding.pools.consumer.cap}
                />
              }
            />
            <Stat
              label="Founding coaches"
              value={`${q.data.founding.pools.coach.used} / ${q.data.founding.pools.coach.cap}`}
              hint={
                <Meter
                  used={q.data.founding.pools.coach.used}
                  cap={q.data.founding.pools.coach.cap}
                />
              }
            />
            <Stat
              label="Recorded revenue"
              value={formatMinor(q.data.founding.revenueMinor)}
              hint={`${q.data.founding.pending} pending (paid, not signed up yet)`}
            />
            <Stat
              label="Referral claims"
              value={q.data.referrals.claims}
              hint={`${q.data.referrals.codes} codes · ${q.data.referrals.lockedClaims} converted`}
            />
          </div>
          <Panel title="By tier">
            {q.data.founding.byTier.length === 0 ? (
              <EmptyState>No grants yet.</EmptyState>
            ) : (
              <Table head={["Tier", "Grants", "Revenue"]}>
                {q.data.founding.byTier.map((t) => (
                  <tr key={t.tierName}>
                    <td>{t.tierName}</td>
                    <td className="tabular-nums">{t.count}</td>
                    <td className="tabular-nums">
                      {formatMinor(t.revenueMinor)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
          <Panel title="Latest grants">
            {q.data.recentGrants.length === 0 ? (
              <EmptyState>
                Nothing recorded yet — the first one is a button away.
              </EmptyState>
            ) : (
              <Table head={["Email", "Tier", "Paid", "Status", "Invited"]}>
                {q.data.recentGrants.map((g) => (
                  <tr key={g.id}>
                    <td>{g.email}</td>
                    <td>{g.tierLabel ?? g.tierName}</td>
                    <td className="tabular-nums">
                      {formatMinor(g.amountMinor, g.currency)}
                    </td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                    <td>
                      {g.invitedAt ? formatDate(g.invitedAt) : "not sent"}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
      ) : q.isPending ? (
        <EmptyState>Loading…</EmptyState>
      ) : null}
    </>
  );
}

import { useState } from "react";
import {
  IconAlertTriangle,
  IconChartBar,
  IconCircleCheck,
  IconEyeOff,
  IconMailPlus,
  IconUsers,
} from "@tabler/icons-react";
import { catalogTier } from "@persistence/subscription-catalog";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

type AdminState = "healthy" | "limit" | "suppressed";

const ADMIN_STATES = {
  healthy: { activated: 52, invited: 9, weekly: 41, workouts: 1842 },
  limit: { activated: 75, invited: 0, weekly: 58, workouts: 2610 },
  suppressed: { activated: 4, invited: 2, weekly: null, workouts: null },
} as const;

export function OrganisationAdmin() {
  const [state, setState] = useState<AdminState>("healthy");
  const plan = catalogTier("studio");
  const data = ADMIN_STATES[state];
  const capacity = typeof plan.clients === "number" ? plan.clients : 0;
  const limitReached = data.activated >= capacity;
  const suppressed = data.activated < 5;

  useSeo({
    title: "Organisation admin — Persistence",
    description:
      "Aggregate seat and engagement administration for Persistence organisation plans.",
    path: "/org-admin",
  });

  return (
    <MarketingLayout>
      <main className="org-admin-page">
        <div className="c">
          <header className="org-admin-header">
            <div>
              <span className="kicker c-accent">Organisation admin</span>
              <h1>Northwind Logistics</h1>
              <p>Aggregate seat management and privacy-safe engagement only.</p>
            </div>
            <div className="org-state-picker" aria-label="Preview admin state">
              {(["healthy", "limit", "suppressed"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={state === value ? "active" : undefined}
                  onClick={() => setState(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </header>

          {limitReached && (
            <div className="org-admin-alert limit" role="status">
              <IconAlertTriangle size={19} />
              <span>
                Seat limit reached. Upgrade the organisation plan before
                inviting more members.
              </span>
            </div>
          )}

          <section
            className="org-admin-grid"
            aria-label="Organisation overview"
          >
            <article className="org-admin-card seat-card">
              <div className="org-card-heading">
                <IconUsers size={20} />
                <span>Seats</span>
              </div>
              <strong>
                {data.activated} <small>of {capacity} activated</small>
              </strong>
              <div className="org-capacity-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.min(100, (data.activated / capacity) * 100)}%`,
                  }}
                />
              </div>
              <p>{data.invited} invitations pending</p>
              <button type="button" disabled={limitReached}>
                <IconMailPlus size={17} /> Invite members
              </button>
            </article>

            <article className="org-admin-card">
              <div className="org-card-heading">
                <IconChartBar size={20} />
                <span>Engagement</span>
              </div>
              {suppressed ? (
                <div
                  className="suppressed-metrics"
                  data-testid="suppressed-metrics"
                >
                  <IconEyeOff size={28} />
                  <strong>Metrics suppressed</strong>
                  <p>
                    Engagement becomes available once the cohort contains at
                    least five activated members.
                  </p>
                </div>
              ) : (
                <div className="aggregate-metrics">
                  <div>
                    <strong>{data.weekly}</strong>
                    <span>weekly active members</span>
                  </div>
                  <div>
                    <strong>{data.workouts?.toLocaleString("en-GB")}</strong>
                    <span>aggregate workouts</span>
                  </div>
                </div>
              )}
            </article>

            <article className="org-admin-card privacy-card">
              <div className="org-card-heading">
                <IconCircleCheck size={20} />
                <span>Privacy boundary</span>
              </div>
              <h2>No individual health data</h2>
              <p>
                Organisation admins see seats, invitations and cohort-level
                engagement. Workouts, nutrition, measurements and member
                histories remain private.
              </p>
            </article>
          </section>
        </div>
      </main>
    </MarketingLayout>
  );
}

export default OrganisationAdmin;

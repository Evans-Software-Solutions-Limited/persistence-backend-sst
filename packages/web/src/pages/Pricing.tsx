import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  ADAPTIVE_SUITE_LABEL,
  annualSaving,
  ctaFor,
  monthlyEquivalent,
  tiersFor,
  type BillingCadence,
  type CatalogTier,
  type SubscriptionAudience,
} from "@persistence/subscription-catalog";
import {
  IconBuildingSkyscraper,
  IconCheck,
  IconInfoCircle,
  IconSparkles,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { TEAMS_MAILTO } from "@/marketing/config";
import { useReveal } from "@/marketing/hooks";
import { useSeo } from "@/marketing/seo";

const AUDIENCE_TABS: readonly {
  id: SubscriptionAudience;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
}[] = [
  {
    id: "consumer",
    label: "Individuals",
    eyebrow: "Personal plans",
    title: "Train yourself",
    description:
      "Free to start. Premium+ unlocks the full adaptive suite — Loadout + Mealprint.",
  },
  {
    id: "coach",
    label: "Coaches",
    eyebrow: "Coach plans",
    title: "Coach your clients",
    description:
      "Choose by client capacity, then add the adaptive suite at the entry rung or get it included above.",
  },
  {
    id: "org",
    label: "Organisations",
    eyebrow: "Organisation plans",
    title: "Gyms, studios and teams",
    description:
      "Bought and managed on the web, with private member data kept out of organisation reporting.",
  },
];

function Price({
  tier,
  cadence = "monthly",
  compact = false,
  monthlyEquivalentOnly = false,
}: {
  tier: CatalogTier;
  cadence?: BillingCadence;
  compact?: boolean;
  monthlyEquivalentOnly?: boolean;
}) {
  if (tier.invoiced) {
    return <span className="catalog-price invoiced">Invoiced</span>;
  }

  const annual = cadence === "annual" && tier.annual !== null;
  const value = monthlyEquivalentOnly
    ? monthlyEquivalent(tier)
    : annual
      ? tier.annual
      : tier.monthly;
  const provisional = annual ? tier.provisionalAnnual : tier.provisionalMonthly;

  if (value === null) return null;

  const formatted = value.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });

  return (
    <span
      className={`catalog-price${compact ? " compact" : ""}${
        provisional ? " provisional" : ""
      }`}
      title={provisional ? "Provisional — price not yet finalised" : undefined}
    >
      <span className="currency">£</span>
      <span className="amount">
        {formatted}
        {provisional && <sup>*</sup>}
      </span>
      {value !== 0 && (
        <span className="unit">
          {annual && !monthlyEquivalentOnly ? "/yr" : "/mo"}
        </span>
      )}
    </span>
  );
}

function CadenceToggle({
  cadence,
  onChange,
}: {
  cadence: BillingCadence;
  onChange: (cadence: BillingCadence) => void;
}) {
  return (
    <div className="catalog-cadence" aria-label="Billing cadence">
      {(["monthly", "annual"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={cadence === value ? "active" : undefined}
          onClick={() => onChange(value)}
        >
          {value === "monthly" ? "Monthly" : "Annual"}
          {value === "annual" && <span>save</span>}
        </button>
      ))}
    </div>
  );
}

function SuiteLine({ included }: { included: boolean }) {
  return (
    <div className={`suite-line ${included ? "included" : "excluded"}`}>
      {included ? <IconSparkles size={16} /> : <IconX size={16} />}
      <span>
        {included
          ? `${ADAPTIVE_SUITE_LABEL} included`
          : "Adaptive suite not included"}
      </span>
    </div>
  );
}

function IapCta({ tier }: { tier: CatalogTier }) {
  const cta = ctaFor(tier);
  return (
    <span className="btn btn-line btn-block cta-soon" aria-disabled="true">
      {cta.label}
    </span>
  );
}

function WebCta({ tier }: { tier: CatalogTier }) {
  const cta = ctaFor(tier);
  return (
    <a
      href={TEAMS_MAILTO}
      className={`btn btn-block ${tier.highlight ? "btn-accent" : "btn-line"}`}
    >
      {cta.label}
    </a>
  );
}

function PlanFeature({ children }: { children: ReactNode }) {
  return (
    <li>
      <IconCheck className="chk" size={17} />
      <span>{children}</span>
    </li>
  );
}

function PlanCard({
  tier,
  cadence,
}: {
  tier: CatalogTier;
  cadence: BillingCadence;
}) {
  const saving = annualSaving(tier);
  const equivalent = monthlyEquivalent(tier);
  const isAnnual = cadence === "annual" && tier.annual !== null;

  return (
    <article
      className={`plan catalog-plan${tier.highlight ? " flagship" : ""}${
        tier.audience === "coach" ? " coach" : ""
      }`}
      data-testid={`pricing-tier-${tier.id}`}
    >
      {tier.highlight && (
        <span
          className={`plan-ribbon ${tier.audience === "org" ? "cyan" : "gold"}`}
        >
          {tier.audience === "consumer" ? "Loadout + Mealprint" : "Recommended"}
        </span>
      )}
      <div className="plan-name-row">
        <div>
          <div className="plan-name">{tier.name}</div>
          <div className="plan-status">{tier.tagline}</div>
        </div>
        {tier.clients !== null && (
          <span className="seats">
            <IconUsers size={15} />
            {typeof tier.clients === "number"
              ? `Up to ${tier.clients}`
              : tier.clients}
          </span>
        )}
      </div>

      <Price tier={tier} cadence={cadence} />
      <div className="plan-sub">
        {tier.invoiced ? (
          "Custom terms"
        ) : isAnnual && equivalent !== null ? (
          <>
            <Price tier={tier} cadence="annual" compact monthlyEquivalentOnly />{" "}
            billed annually{saving ? ` · save ${saving}%` : ""}
          </>
        ) : tier.monthly === 0 ? (
          "Free forever"
        ) : (
          "Billed monthly"
        )}
      </div>

      <SuiteLine included={tier.suite} />
      <ul className="plan-feats">
        {tier.features.map((feature) => (
          <PlanFeature key={feature}>{feature}</PlanFeature>
        ))}
      </ul>

      {tier.rail === "web" ? <WebCta tier={tier} /> : <IapCta tier={tier} />}
    </article>
  );
}

const MATRIX_ROWS: readonly {
  label: string;
  value: (tier: CatalogTier) => string | boolean;
}[] = [
  {
    label: "Workout and nutrition tracking",
    value: () => true,
  },
  {
    label: "Loadout + Mealprint",
    value: (tier) => tier.suite,
  },
  {
    label: "Coach tools",
    value: (tier) => tier.audience === "coach",
  },
  {
    label: "Client capacity",
    value: (tier) =>
      tier.audience === "coach" && tier.clients !== null
        ? String(tier.clients)
        : "—",
  },
];

function TierMatrix() {
  const tiers = [...tiersFor("consumer"), ...tiersFor("coach")];
  return (
    <section
      className="catalog-matrix-section"
      aria-labelledby="tier-matrix-title"
    >
      <div className="sec-head center">
        <span className="kicker c-accent center">Compare plans</span>
        <h2 className="disp" id="tier-matrix-title">
          The whole ladder, <span className="it">clearly.</span>
        </h2>
      </div>
      <div className="catalog-matrix-wrap">
        <table className="catalog-matrix">
          <thead>
            <tr>
              <th>Feature</th>
              {tiers.map((tier) => (
                <th key={tier.id}>{tier.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {tiers.map((tier) => {
                  const value = row.value(tier);
                  return (
                    <td key={tier.id}>
                      {value === true ? (
                        <IconCheck aria-label="Included" size={17} />
                      ) : value === false ? (
                        <span aria-label="Not included">—</span>
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Pricing() {
  const revealRef = useReveal<HTMLDivElement>();
  const [audience, setAudience] = useState<SubscriptionAudience>("consumer");
  const [cadence, setCadence] = useState<BillingCadence>("annual");
  const active = AUDIENCE_TABS.find((tab) => tab.id === audience)!;
  const tiers = useMemo(() => tiersFor(audience), [audience]);
  const provisionalAnnuals = tiers.some((tier) => tier.provisionalAnnual);

  useSeo({
    title:
      "Pricing — Persistence Gym & Coaching App | Individuals, Coaches & Organisations",
    description:
      "Persistence plans for individuals, coaches and organisations, including Premium+ with Loadout and Mealprint.",
    path: "/pricing",
  });

  return (
    <MarketingLayout current="pricing">
      <div ref={revealRef} className="catalog-page">
        <section className="ph catalog-hero">
          <div className="c">
            <span className="kicker c-accent center">Pricing</span>
            <h1 className="disp">
              One subscription. <span className="it">Your</span> way to train.
            </h1>
            <p className="ph-sub">
              Start with the audience that fits you. Every card makes the
              adaptive suite and client capacity explicit.
            </p>

            <div
              className="catalog-tabs"
              role="tablist"
              aria-label="Pricing audience"
            >
              {AUDIENCE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={audience === tab.id}
                  className={audience === tab.id ? "active" : undefined}
                  onClick={() => setAudience(tab.id)}
                >
                  {tab.id === "org" && <IconBuildingSkyscraper size={16} />}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="sec-pad catalog-plans" id={audience}>
          <div className="c">
            <div className="catalog-section-head">
              <div className="sec-head">
                <span className="kicker c-accent">{active.eyebrow}</span>
                <h2 className="disp">{active.title}</h2>
                <p>{active.description}</p>
              </div>
              {audience !== "org" && (
                <CadenceToggle cadence={cadence} onChange={setCadence} />
              )}
            </div>

            {audience !== "consumer" && (
              <div className="suite-definition">
                <IconSparkles size={17} />
                <span>
                  <b>The adaptive suite</b> = Loadout (equipment-aware training)
                  + Mealprint (AI meal planning).
                </span>
              </div>
            )}

            <div className={`plans catalog-grid ${audience}`}>
              {tiers.map((tier) => (
                <PlanCard key={tier.id} tier={tier} cadence={cadence} />
              ))}
            </div>

            {provisionalAnnuals && (
              <p className="catalog-provisional-note">
                * Provisional annual price — final value pending confirmation.
              </p>
            )}

            <div className="catalog-note">
              <IconInfoCircle size={18} />
              <span>
                <b>Nutrition is built in.</b> Meal planning is included on every
                plan carrying the adaptive suite, never sold as a separate
                add-on.
              </span>
            </div>

            {audience === "org" && import.meta.env.DEV && (
              <p className="catalog-admin-link">
                Already managing a plan?{" "}
                <Link to="/org-admin">Open organisation admin</Link>
              </p>
            )}
          </div>
        </section>

        <div className="c">
          <TierMatrix />
        </div>

        <section className="sec-pad faq" id="faq">
          <div className="c">
            <div className="sec-head center">
              <h2 className="disp">
                Good to <span className="it">know.</span>
              </h2>
            </div>
            <div className="faq-grid">
              <div className="faq-item">
                <h4>What is the adaptive suite?</h4>
                <p>
                  Loadout adapts training to the equipment available; Mealprint
                  builds meal plans around your targets.
                </p>
              </div>
              <div className="faq-item">
                <h4>Where do I buy an individual or coach plan?</h4>
                <p>
                  Those plans will be purchased in the Persistence app. Until
                  App Store products are ready, their controls remain disabled.
                </p>
              </div>
              <div className="faq-item">
                <h4>How is organisation reporting kept private?</h4>
                <p>
                  Admin reporting is aggregate-only and engagement metrics are
                  suppressed whenever the cohort has fewer than five members.
                </p>
              </div>
              <div className="faq-item">
                <h4>Is nutrition another add-on?</h4>
                <p>
                  No. Nutrition tracking is built in, and Mealprint is included
                  wherever the adaptive suite is included.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

export default Pricing;

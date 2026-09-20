import { useCampaign } from "./campaign";
import {
  FOUNDING_COPY,
  FOUNDING_PLANS,
  formatPrice,
  type FoundingPlan,
} from "./foundingOffer";
interface PlanCardProps {
  plan: FoundingPlan;
  onChoose: (plan: FoundingPlan) => void;
  disabled: boolean;
}

function PlanCard({ plan, onChoose, disabled }: PlanCardProps) {
  return (
    <article
      className={`founding-plan${plan.featured ? " founding-plan-featured" : ""}`}
    >
      <span>{plan.tierLabel}</span>
      <strong>
        {formatPrice(plan.priceMinor)} · {plan.termLabel}
      </strong>
      <p>{plan.blurb}</p>
      {/* The price is ON the button (LANDING_PAGE.md § 4) so the click is
          informed; the tier is in the accessible name, which the visible
          label alone would not carry between two cards. */}
      <button
        type="button"
        className="btn btn-fill"
        disabled={disabled}
        aria-label={`${plan.tierLabel}, ${plan.termLabel} — ${formatPrice(plan.priceMinor)}`}
        onClick={() => onChoose(plan)}
      >
        {plan.termLabel} — {formatPrice(plan.priceMinor)}
      </button>
    </article>
  );
}

export interface FoundingPlansProps {
  soldOut?: boolean;
}
export function FoundingPlans({ soldOut = false }: FoundingPlansProps) {
  const campaign = useCampaign();
  return (
    <div className="founding-plans-shell">
      <h2 className="founding-plans-heading">{FOUNDING_COPY.plansHeading}</h2>
      <div className="founding-plans" aria-label={FOUNDING_COPY.plansLabel}>
        {FOUNDING_PLANS.map((plan) => (
          <PlanCard
            key={`${plan.tier}-${plan.months}`}
            plan={plan}
            disabled={soldOut}
            onChoose={(chosen) =>
              window.location.assign(
                `/founding/access?tier=${chosen.tier}&months=${chosen.months}${campaign ? `&campaign=${encodeURIComponent(campaign)}` : ""}`,
              )
            }
          />
        ))}
      </div>
      <p className="founding-plans-caption">
        {soldOut ? FOUNDING_COPY.soldOutNote : FOUNDING_COPY.plansCaption}
      </p>
      <p className="founding-note">
        <a href="/founding/access">Already purchased? Activate your access</a>
      </p>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";
import { FoundingPlans } from "@/marketing/FoundingPlans";
import {
  FOUNDING_CONTACT_EMAIL,
  FOUNDING_COPY,
  foundingOfferIsOpen,
} from "@/marketing/foundingOffer";

export { FOUNDING_CONTACT_EMAIL };

type Availability = {
  consumer: { used: number; cap: number };
  coach: { used: number; cap: number };
};

async function loadAvailability(): Promise<Availability> {
  const base = (import.meta.env.VITE_CORE_API_URL ?? "").replace(/\/$/, "");
  const response = await fetch(`${base}/founding/availability`);
  if (!response.ok) throw new Error("Availability could not be loaded");
  const body = (await response.json()) as { data: Availability };
  return body.data;
}

function AvailabilityLine({
  label,
  value,
}: {
  label: string;
  value: { used: number; cap: number } | undefined;
}) {
  return (
    <span>
      <strong>{value ? `${value.used} of ${value.cap}` : "Live count"}</strong>{" "}
      {label} {value ? "taken" : "temporarily unavailable"}
    </span>
  );
}

/**
 * The founding offer page (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * Sells fixed-term, non-renewing access through Stripe Checkout. Every string
 * comes from `FOUNDING_COPY`; the approved wording lands with
 * `LANDING_PAGE.md` and replaces those constants without touching this file.
 *
 * Two things are decided here and enforced again on the server, which is the
 * authority in both cases: whether the offer is still open (a client clock can
 * be wrong, so the checkout route answers 410 regardless), and whether any
 * places are left (the seat count here is a cached read; the route re-checks
 * under the pool lock).
 */
export function Founding() {
  const [params] = useSearchParams();
  const cancelled = params.get("cancelled") === "1";
  const open = foundingOfferIsOpen();

  const availability = useQuery({
    queryKey: ["founding", "availability"],
    queryFn: loadAvailability,
    staleTime: 30_000,
    enabled: open,
  });

  // LANDING_PAGE.md § 11.
  useSeo({
    title: "Founding offer — Persistence gym & coaching app",
    description:
      "Six months of Persistence Premium for £30, or a year for £60. Training, nutrition and progress in one app. Founding prices until 30 September, paid once, nothing renews.",
    path: "/founding",
  });

  const consumer = availability.data?.consumer;
  const soldOut = consumer !== undefined && consumer.used >= consumer.cap;

  return (
    <MarketingLayout>
      <section className="founding-hero">
        <div className="c founding-shell">
          <span className="kicker c-accent">{FOUNDING_COPY.kicker}</span>

          {open ? (
            <>
              <h1>{FOUNDING_COPY.heading}</h1>
              <p className="founding-intro">{FOUNDING_COPY.intro}</p>
              <p className="founding-scarcity">{FOUNDING_COPY.scarcityNote}</p>

              {cancelled ? (
                <p className="founding-note" role="status">
                  {FOUNDING_COPY.cancelledNote}
                </p>
              ) : null}

              <h2 className="founding-plans-heading">
                {FOUNDING_COPY.plansHeading}
              </h2>
              <FoundingPlans soldOut={soldOut} />
              <p className="founding-plans-caption">
                {FOUNDING_COPY.plansCaption}
              </p>

              <p className="founding-counter" aria-live="polite">
                <AvailabilityLine label="founding places" value={consumer} />
                {" · "}
                <AvailabilityLine
                  label="coach places"
                  value={availability.data?.coach}
                />
              </p>
            </>
          ) : (
            <>
              <h1>{FOUNDING_COPY.closedHeading}</h1>
              <p className="founding-intro">{FOUNDING_COPY.closedBody}</p>
            </>
          )}

          <div className="founding-coach">
            <div>
              <span className="kicker">{FOUNDING_COPY.coachHeading}</span>
              <p>
                {FOUNDING_COPY.coachBody}{" "}
                <a href={`mailto:${FOUNDING_CONTACT_EMAIL}`}>
                  {FOUNDING_CONTACT_EMAIL}
                </a>
                .
              </p>
            </div>
          </div>

          <p className="founding-terms">
            Read the <Link to="/terms">terms and conditions</Link>.
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}

export default Founding;

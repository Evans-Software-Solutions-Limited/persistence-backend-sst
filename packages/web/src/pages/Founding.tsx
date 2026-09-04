import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

export const FOUNDING_CONTACT_EMAIL = "admin@evans-software-solutions.com";

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
      {label} {value ? "allocated" : "temporarily unavailable"}
    </span>
  );
}

export function Founding() {
  const availability = useQuery({
    queryKey: ["founding", "availability"],
    queryFn: loadAvailability,
    staleTime: 30_000,
  });

  useSeo({
    title: "Founding access — Persistence",
    description:
      "Limited founding access to Persistence, allocated personally and separate from optional crowdfunding support.",
    path: "/founding",
  });

  return (
    <MarketingLayout>
      <section className="founding-hero">
        <div className="c founding-shell">
          <span className="kicker c-accent">Founding access</span>
          <h1>I turn 30 this month. A limited number of founding places.</h1>
          <p className="founding-intro">
            Founding access is allocated personally for a specific Persistence
            tier and period. It does not renew automatically.
          </p>

          <div className="founding-plans" aria-label="Available access tiers">
            <article className="founding-plan">
              <span>Premium</span>
              <strong>Build consistency</strong>
              <p>Consumer access for the period agreed with Brad.</p>
            </article>
            <article className="founding-plan founding-plan-featured">
              <span>Premium+</span>
              <strong>Go further</strong>
              <p>Full consumer access for the period agreed with Brad.</p>
            </article>
          </div>

          <div className="founding-coach">
            <div>
              <span className="kicker">For coaches</span>
              <h2>Start Up Coach+</h2>
              <p>Coach access is allocated from its own limited pool.</p>
            </div>
          </div>

          <p className="founding-counter" aria-live="polite">
            <AvailabilityLine
              label="consumer places"
              value={availability.data?.consumer}
            />
            {" · "}
            <AvailabilityLine
              label="coach places"
              value={availability.data?.coach}
            />
          </p>

          <div className="founding-details">
            <section>
              <h2>Access is granted, not sold here</h2>
              <p>
                There is no checkout or payment code on this website. Brad
                records the tier and access period, then the grant is applied to
                the email you use in the app.
              </p>
            </section>
            <section>
              <h2>How to ask for a place</h2>
              <p>
                Speak to Brad in person, or email{" "}
                <a href={`mailto:${FOUNDING_CONTACT_EMAIL}`}>
                  {FOUNDING_CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>
            <section>
              <h2>Crowdfunding is separate</h2>
              <p>
                You may choose to contribute to the wider launch separately. A
                contribution does not buy, guarantee, size, or extend access.
              </p>
            </section>
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

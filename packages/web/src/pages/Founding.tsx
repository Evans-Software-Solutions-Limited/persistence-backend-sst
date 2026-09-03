import { Link } from "react-router";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

interface FoundingPaymentLinks {
  premium?: string;
  premiumPlus?: string;
  coach?: string;
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function foundingSeatsUsed(): number {
  const parsed = Number(import.meta.env.VITE_FOUNDING_SEATS_USED ?? "0");
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function paymentLinks(): FoundingPaymentLinks {
  return {
    premium: optionalEnv(import.meta.env.VITE_FOUNDING_STRIPE_PREMIUM_URL),
    premiumPlus: optionalEnv(
      import.meta.env.VITE_FOUNDING_STRIPE_PREMIUM_PLUS_URL,
    ),
    coach: optionalEnv(import.meta.env.VITE_FOUNDING_STRIPE_COACH_URL),
  };
}

function PaymentLink({ href, children }: { href?: string; children: string }) {
  if (!href) return null;
  return (
    <a
      className="btn btn-accent btn-block"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

export function Founding() {
  const seatsUsed = foundingSeatsUsed();
  const bankDetails = optionalEnv(import.meta.env.VITE_FOUNDING_BANK_DETAILS);
  const links = paymentLinks();

  useSeo({
    title: "Founding offer — Persistence",
    description:
      "Six months of Persistence Premium, Premium+ or Start Up Coach+ through the limited founding offer.",
    path: "/founding",
  });

  return (
    <MarketingLayout>
      <section className="founding-hero">
        <div className="c founding-shell">
          <span className="kicker c-accent">Founding offer</span>
          <h1>I turn 30 this month. 200 founding places.</h1>
          <p className="founding-intro">
            Pay once for six months of Persistence. There is no automatic
            renewal on a founding place.
          </p>

          <div className="founding-plans" aria-label="Founding plans">
            <article className="founding-plan">
              <span>Premium</span>
              <strong>£30</strong>
              <p>Six months. No automatic renewal.</p>
              <PaymentLink href={links.premium}>Pay for Premium</PaymentLink>
            </article>
            <article className="founding-plan founding-plan-featured">
              <span>Premium+</span>
              <strong>£50</strong>
              <p>Six months. No automatic renewal.</p>
              <PaymentLink href={links.premiumPlus}>
                Pay for Premium+
              </PaymentLink>
            </article>
          </div>

          <div className="founding-coach">
            <div>
              <span className="kicker">For coaches</span>
              <h2>Start Up Coach+ £99</h2>
              <p>Six months, with 20 founding coach places.</p>
            </div>
            <PaymentLink href={links.coach}>
              Pay for Start Up Coach+
            </PaymentLink>
          </div>

          <p className="founding-counter">
            <strong>{seatsUsed} of 200</strong> places taken
          </p>

          <div className="founding-details">
            <section>
              <h2>What the money funds</h2>
              <p>
                The founding offer funds launch banners, the QR subscription,
                and places at founders&apos; fairs.
              </p>
            </section>
            <section>
              <h2>How redemption works</h2>
              <p>
                Pay, then sign up in the app with the same email — access is on
                within a day; we&apos;ll email you.
              </p>
            </section>
          </div>

          {bankDetails && (
            <section className="founding-bank">
              <h2>Pay by bank transfer</h2>
              <p>{bankDetails}</p>
            </section>
          )}

          <p className="founding-cancellation">
            By paying, you acknowledge your right to cancel this purchase within
            14 days.
          </p>
          <p className="founding-terms">
            Read the <Link to="/terms">terms and conditions</Link>.
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}

export default Founding;

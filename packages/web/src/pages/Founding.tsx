import { Link } from "react-router";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

export const FOUNDING_CONTACT_EMAIL = "admin@evans-software-solutions.com";

function foundingSeatsUsed(): number {
  const parsed = Number(import.meta.env.VITE_FOUNDING_SEATS_USED ?? "0");
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function Founding() {
  const seatsUsed = foundingSeatsUsed();

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
            </article>
            <article className="founding-plan founding-plan-featured">
              <span>Premium+</span>
              <strong>£50</strong>
              <p>Six months. No automatic renewal.</p>
            </article>
          </div>

          <div className="founding-coach">
            <div>
              <span className="kicker">For coaches</span>
              <h2>Start Up Coach+ £99</h2>
              <p>Six months, with 20 founding coach places.</p>
            </div>
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
              <h2>How to get a place</h2>
              <p>
                Speak to Brad in person at an event he attends, or email{" "}
                <a href={`mailto:${FOUNDING_CONTACT_EMAIL}`}>
                  {FOUNDING_CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>
            <section>
              <h2>How access is switched on</h2>
              <p>
                We record your payment. You sign up in the app with the same
                email address and confirm it. Access is on the first time the
                app loads after that. Places must be redeemed within 90 days of
                payment.
              </p>
            </section>
          </div>

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

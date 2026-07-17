import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

/**
 * Public terms of service. Rendered at /terms with no auth gate so the URL can
 * be listed in App Store Connect metadata and linked from the app's settings.
 * Wrapped in the marketing shell so it matches the rest of the site.
 */
export function Terms() {
  useSeo({
    title: "Terms of Service — Persistence",
    description:
      "The terms governing your use of Persistence, including subscriptions, health disclaimer and liability.",
    path: "/terms",
  });

  return (
    <MarketingLayout>
      <section className="legal">
        <span className="kicker c-accent legal-kicker">Legal</span>
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: 10 July 2026</p>

        <h2>Acceptance of terms</h2>
        <p>
          By creating an account or using Persistence (the "app"), you agree to
          these Terms of Service. If you do not agree, please do not use the
          app.
        </p>

        <h2>Permitted use</h2>
        <p>
          Persistence is provided for your personal fitness tracking. You agree
          to use the app only for lawful purposes and not to misuse it,
          interfere with its operation, or attempt to access data belonging to
          other users.
        </p>

        <h2>Subscriptions</h2>
        <p>
          Some features require a paid subscription. Purchases are billed
          through your app store account, and subscriptions renew automatically
          unless cancelled. You can manage or cancel your subscription through
          your app store account settings.
        </p>

        <h2>Health disclaimer</h2>
        <p>
          Persistence is a tracking tool and does not provide medical advice.
          The information in the app is for general fitness purposes only and is
          not a substitute for professional medical guidance. Consult a
          qualified professional before beginning any exercise or nutrition
          programme.
        </p>

        <h2>No warranty</h2>
        <p>
          The app is provided "as is" and "as available", without warranties of
          any kind, whether express or implied. We do not warrant that the app
          will be uninterrupted, error-free, or free of harmful components.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, we will not be liable for any
          indirect, incidental, or consequential damages arising from your use
          of the app.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of England and Wales, without
          regard to conflict-of-law principles.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms can be sent to{" "}
          <a href="mailto:admin@evans-software-solutions.com">
            admin@evans-software-solutions.com
          </a>
          .
        </p>
      </section>
    </MarketingLayout>
  );
}

export default Terms;

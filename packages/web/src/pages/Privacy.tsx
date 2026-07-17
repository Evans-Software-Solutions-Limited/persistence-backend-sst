import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

/**
 * Public privacy policy. Rendered at /privacy with no auth gate so the URL can
 * be listed in App Store Connect metadata and linked from the app's settings.
 * Wrapped in the marketing shell so it matches the rest of the site.
 */
export function Privacy() {
  useSeo({
    title: "Privacy Policy — Persistence",
    description:
      "How Persistence collects, uses and protects your data. We don't sell your personal data or use it for advertising.",
    path: "/privacy",
  });

  return (
    <MarketingLayout>
      <section className="legal">
        <span className="kicker c-accent legal-kicker">Legal</span>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: 13 July 2026</p>

        <p>
          Persistence ("we", "us", "our") is a fitness-tracking application.
          This policy explains what data we collect, how we use it, who we share
          it with, and the rights you have over your information.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account details</strong> — your email address and, if you
            choose Sign in with Apple, the identifier Apple provides.
          </li>
          <li>
            <strong>Workout data</strong> — the workouts, sessions, sets, reps,
            exercises, and personal records you log.
          </li>
          <li>
            <strong>Nutrition data</strong> — meals, food entries, calories, and
            macronutrients you record.
          </li>
          <li>
            <strong>Photos &amp; images</strong> — when you choose to use
            AI-assisted food logging, the meal photo you capture or upload is
            sent to our AI provider to estimate its nutritional content. Photos
            you set as a profile picture are also stored.
          </li>
          <li>
            <strong>Health &amp; body metrics</strong> — measurements such as
            body weight and body fat, and, where you grant permission, data read
            from Apple Health.
          </li>
          <li>
            <strong>Goals &amp; progress</strong> — the goals, habits, and
            progress information you create.
          </li>
        </ul>

        <h2>How we use your information</h2>
        <p>
          We use your data to provide the core features of the app: storing and
          displaying your workouts, nutrition, and progress; syncing your data
          across your devices; and, where applicable, sharing it with a coach or
          trainer you have explicitly connected with. We do not sell your
          personal data, and we do not use it for advertising.
        </p>

        <h2>Third-party services</h2>
        <p>
          We rely on a small number of trusted providers to operate the app.
          Each processes only the data needed for its function:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — authentication and database hosting.
          </li>
          <li>
            <strong>RevenueCat</strong> — subscription and purchase management.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing.
          </li>
          <li>
            <strong>Expo</strong> — delivery of push notifications.
          </li>
          <li>
            <strong>Amazon Web Services (AWS)</strong> — AI processing of the
            meal photos you submit for AI-assisted food logging.
          </li>
        </ul>

        <h2>Data retention</h2>
        <p>
          We keep your data for as long as your account is active. When you
          request deletion, your account is deactivated immediately and
          scheduled for permanent deletion 30 days later. During that 30-day
          window you can restore your account simply by signing back in — your
          data is not removed until the window ends. If you don't sign back in,
          your account and all associated personal data — workouts, nutrition
          logs, progress and personal records, custom workouts and recipes, and
          your profile (including your profile photo) — are permanently deleted
          once the 30 days have passed.
        </p>

        <h2>Your rights</h2>
        <p>
          You can access and update your information from within the app. You
          may request deletion of your account at any time from the app's
          profile settings, which starts the 30-day process described above —
          signing back in during that window restores your account, and no
          further action is taken. You may also contact us to request access to,
          correction of, or deletion of your data.
        </p>

        <h2>Contact</h2>
        <p>
          If you have any questions about this policy or your data, contact us
          at{" "}
          <a href="mailto:admin@evans-software-solutions.com">
            admin@evans-software-solutions.com
          </a>
          .
        </p>
      </section>
    </MarketingLayout>
  );
}

export default Privacy;

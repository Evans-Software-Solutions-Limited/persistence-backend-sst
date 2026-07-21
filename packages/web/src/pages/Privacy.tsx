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
        <p className="legal-updated">Last updated: 21 July 2026</p>

        <p>
          Persistence ("we", "us", "our") is a fitness-tracking application
          operated by Evans Software Solutions Limited, a company registered in
          England and Wales (company number 16938357), whose registered office
          is 320 Loughborough Road, West Bridgford, Nottingham, NG2 7FB. Evans
          Software Solutions Limited is the data controller responsible for your
          personal data.
        </p>
        <p>
          We are registered with the UK Information Commissioner's Office (ICO).
          {/* TODO: replace the bracketed text below with the ICO reference (Z…) once it is issued. */}{" "}
          Our ICO registration number is{" "}
          <strong>[to be added once issued]</strong>.
        </p>
        <p>
          This policy explains what data we collect, how we use it, the legal
          bases we rely on, who we share it with, and the rights you have over
          your information.
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
            from Apple Health. This is special-category (health) data under UK
            data protection law, which we process only with your explicit
            consent.
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

        <h2>Legal bases for using your data</h2>
        <p>
          Under UK data protection law we must have a legal basis for processing
          your personal data:
        </p>
        <ul>
          <li>
            <strong>Performance of a contract (Article 6(1)(b))</strong> — we
            process your account, workout, nutrition, goal and progress data to
            provide the app you have signed up for.
          </li>
          <li>
            <strong>Explicit consent (Article 9(2)(a))</strong> — your health
            and body metrics are special-category data. We process them, and
            share them with a coach where you choose to, only on the basis of
            your explicit consent, which you can withdraw at any time.
          </li>
        </ul>

        <h2>Sharing data with your coach</h2>
        <p>
          If you connect with a coach or trainer inside the app, you will be
          asked to give explicit consent before any of your data is shared. With
          your consent, your coach can see: your body measurements (including
          weight and body fat), your workout sessions and personal records, your
          nutrition totals, and your goals and habits. Your raw Apple Health
          data (such as sleep, heart rate, and steps) is never shared with your
          coach.
        </p>
        <p>
          You can withdraw this consent at any time by removing your coach in
          the app, which immediately stops all further sharing. We keep a record
          of when you gave and withdrew consent, and a record of when a coach
          accessed your data, so we can answer any request you make about who
          has seen your information.
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
            <strong>Amazon Web Services (AWS)</strong> — hosting and AI
            processing of the meal photos you submit for AI-assisted food
            logging.
          </li>
          <li>
            <strong>Sentry</strong> — error and crash reporting to help us keep
            the app reliable. Technical error data is automatically scrubbed to
            remove personal information before it is sent.
          </li>
        </ul>
        <p>
          Your personal data is stored and processed within the United Kingdom
          and European Union, including the AI processing of meal photos.
        </p>

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
          Under UK data protection law you have the right to access, correct, or
          delete your personal data; to restrict or object to how we process it;
          to receive a copy of it in a portable format; and, where we rely on
          your consent, to withdraw that consent at any time.
        </p>
        <p>
          You can access and update your information from within the app. You
          may request deletion of your account at any time from the app's
          profile settings, which starts the 30-day process described above —
          signing back in during that window restores your account, and no
          further action is taken. You can withdraw consent to coach sharing at
          any time by removing your coach. You may also contact us to exercise
          any of these rights.
        </p>
        <p>
          If you have a concern about how we handle your data, you have the
          right to lodge a complaint with the Information Commissioner's Office
          (ICO), the UK supervisory authority, at{" "}
          <a href="https://ico.org.uk/make-a-complaint/">
            ico.org.uk/make-a-complaint
          </a>{" "}
          or by calling their helpline on 0303 123 1113. We would, however,
          appreciate the chance to address your concerns first, so please do
          contact us before approaching the ICO.
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

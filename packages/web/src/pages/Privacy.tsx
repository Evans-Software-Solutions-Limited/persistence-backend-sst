import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

/**
 * Public privacy policy. Rendered at /privacy with no auth gate so the URL can
 * be listed in App Store Connect metadata and linked from the app's settings.
 * Wrapped in the marketing shell so it matches the rest of the site.
 *
 * ⚠ This page and `packages/mobile/.../PrivacyPolicyPresenter.tsx` are two
 * copies of the SAME document. They diverged once already (the in-app copy sat
 * at "January 2025" saying under-13 while this one said nothing about age at
 * all — two contradicting live policies is itself a UK GDPR Art 5(1)(a)
 * accuracy problem). Change both together, or neither — both have tests pinning
 * the legally-weighted claims, so a one-sided edit fails CI.
 *
 * ONE deliberate divergence: the "Cookies and the Persistence website" section
 * below has no in-app counterpart, because an in-app screen sets no website
 * cookies. That is the only content difference; anything else is a bug.
 *
 * Every factual claim below was checked against the code on 2026-08-03. Do NOT
 * add a claim here that the implementation does not actually deliver — and note
 * the two places where the wording is deliberately loose because the mechanism
 * behind it is not yet automated (the 12-month "periodically", and "at least"
 * six years for the never-pruned provider webhook-event tables). Tightening
 * either sentence requires landing the prune first.
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
        <p className="legal-updated">Last updated: 3 August 2026</p>

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
          Our ICO registration number is <strong>ZC204325</strong>.
        </p>
        <p>
          This policy explains what data we collect, how we use it, the legal
          bases we rely on, who we share it with, and the rights you have over
          your information.
        </p>

        <h2>Who can use Persistence</h2>
        <p>
          Persistence is intended for users aged 16 or over. We do not knowingly
          collect personal data from anyone under that age.
        </p>
        <p>
          If you are a parent or guardian and believe your child has created an
          account, please contact us at{" "}
          <a href="mailto:admin@evans-software-solutions.com">
            admin@evans-software-solutions.com
          </a>{" "}
          and we will delete the account and its data promptly. If we become
          aware that an account belongs to someone under 16, we will delete it
          and the associated data without undue delay.
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
            analysed to estimate its nutritional content. Photos you set as a
            profile picture are also stored. See "AI features and what they do
            with your data" below for what happens to the photos you submit.
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
          <li>
            <strong>Technical data</strong> — limited diagnostic information
            about your device and errors or crashes in the app, used to keep the
            service secure and reliable.
          </li>
        </ul>
        <p>
          Your profile picture is served from a public web address so that it
          can be displayed to coaches and other users you connect with. It is
          not listed, indexed, or published anywhere else, but it is not
          protected by a password — if you would rather it were not reachable
          that way, you can remove your profile picture at any time in the app.
        </p>

        <h2>How we use your information</h2>
        <p>
          We use your data to provide the core features of the app: storing and
          displaying your workouts, nutrition, and progress; syncing your data
          across your devices; and, where applicable, sharing it with a coach or
          trainer you have explicitly connected with. We do not sell your
          personal data, and we do not use it for advertising.
        </p>

        <h2>AI features and what they do with your data</h2>
        <p>
          Several features in the app use an AI model to interpret something you
          have given us. In every case the processing is carried out by our AI
          provider (Amazon Web Services) in UK or EEA regions, and{" "}
          <strong>nothing you send is used to train AI models</strong>, ours or
          anyone else's.
        </p>
        <ul>
          <li>
            <strong>Food logging from a photo</strong> — the meal photo you
            capture is analysed to estimate its nutritional content.
          </li>
          <li>
            <strong>Food logging from a description</strong> — if you type what
            you ate, or ask us to match an ingredient, that text is analysed to
            estimate its nutritional content.
          </li>
          <li>
            <strong>Recipes from a photo</strong> — the image you provide is
            analysed to extract the ingredients and method.
          </li>
          <li>
            <strong>Equipment scanning and workout adaptation</strong> — a photo
            of your gym is analysed to identify the equipment available, and
            your workout and the equipment list are used to suggest substitute
            exercises.
          </li>
          <li>
            <strong>Coach summaries</strong> — if you have consented to share
            your data with a coach, your coach can generate a written summary of
            your recent progress. To produce it we send your first name, your
            weight and goal weight, your personal records, and your recent
            training, nutrition and habit adherence to our AI provider. Unlike
            the features above, the summary that comes back{" "}
            <strong>is stored</strong>, so your coach can read it again without
            regenerating it. If you end the coaching relationship your coach can
            no longer access it, and it is deleted when your account is deleted.
            If you later reconnect with the same coach, summaries from before
            become available to them again.
          </li>
        </ul>
        <p>
          <strong>The images and text you submit are not stored.</strong> They
          are held only in memory for as long as the analysis takes, and are
          then discarded — there is no photo library of your meals, recipes or
          gym on our servers. What is kept is only the result you choose to save
          (for example the nutritional values in your food log), the coach
          summary described above, and the link to any recipe you imported,
          which we keep on the saved recipe so you can find the original.
        </p>
        <p>
          Everything these features produce is a suggestion, not a measurement.
          You can review and change any value before saving it, and no decision
          is taken about you on the basis of an AI output alone.
        </p>
        {/* This subsection must stay LAST in the AI section. Nothing closes an
            <h3> but the next heading, so anything placed after it is
            semantically scoped inside it — and the paragraph above is the
            document's automated-decision statement, which must not end up filed
            under a heading whose first sentence is "This one does not involve
            AI." */}
        <h3>Importing a recipe from a link</h3>
        <p>
          This one does not involve AI. When you give us a recipe's web address,
          our servers fetch that page on your behalf and read the recipe data
          the site publishes in a machine-readable format. Because the request
          comes from our servers rather than your device, the site you named
          sees a request from us, not from you. No AI model is involved, and we
          do not keep a copy of the page — only the ingredients and method you
          choose to save, and the link itself.
        </p>

        <h2>Legal bases for using your data</h2>
        <p>
          Under UK data protection law we must have a legal basis for processing
          your personal data. We rely on the following:
        </p>
        <ul>
          <li>
            <strong>Performance of a contract (Article 6(1)(b))</strong> — we
            process your account, workout, nutrition, goal and progress data in
            order to provide the app you have signed up for, and to manage your
            subscription.
          </li>
          <li>
            <strong>Explicit consent (Article 9(2)(a))</strong> — your health
            and body metrics are special-category data. We process them, and
            share them with a coach where you choose to, only on the basis of
            your explicit consent, which you can withdraw at any time.
          </li>
          <li>
            <strong>Legitimate interests (Article 6(1)(f))</strong> — we process
            limited technical data to keep the app secure and reliable, to
            diagnose errors and crashes, to prevent fraud and abuse of our
            service, and to defend legal claims. We have considered your rights
            and interests in each case and have concluded that this processing
            is necessary and does not override them. You can object to this
            processing at any time by contacting us.
          </li>
          <li>
            <strong>Legal obligation (Article 6(1)(c))</strong> — we retain
            certain records, such as transaction records, where the law requires
            us to.
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
            <strong>Apple</strong> — all subscription purchases made in the iOS
            app are processed by Apple through In-App Purchase. We never see or
            hold your card details.
          </li>
          <li>
            <strong>RevenueCat</strong> — subscription and purchase management.
          </li>
          <li>
            <strong>Stripe</strong> — card payment processing for historic
            subscriptions taken before purchases moved to Apple In-App Purchase.
          </li>
          <li>
            <strong>Expo</strong> — delivery of push notifications.
          </li>
          <li>
            <strong>Amazon Web Services (AWS)</strong> — hosting, and the AI
            processing behind the features described above.
          </li>
          <li>
            <strong>Sentry</strong> — error and crash reporting to help us keep
            the app reliable. Technical error data is automatically scrubbed to
            remove personal information before it is sent.
          </li>
        </ul>

        <h2>Where your data is stored and international transfers</h2>
        <p>
          Your personal data is stored and processed within the United Kingdom
          and the European Economic Area, including the AI processing described
          above. We have configured our providers to store and process data in
          UK or EEA regions.
        </p>
        <p>
          Some of our providers are based outside the UK, and their support or
          engineering teams may need to access data from another country in
          order to operate or troubleshoot the service. Where that happens, the
          transfer is protected by one of the safeguards recognised under UK
          data protection law:
        </p>
        <ul>
          <li>
            the UK International Data Transfer Agreement, or the UK Addendum to
            the European Commission's standard contractual clauses; or
          </li>
          <li>
            a finding of adequacy by the UK government in respect of the
            destination country.
          </li>
        </ul>
        <p>
          You can ask us for more detail about the safeguards applying to a
          particular provider by contacting us at{" "}
          <a href="mailto:admin@evans-software-solutions.com">
            admin@evans-software-solutions.com
          </a>
          .
        </p>

        <h2>How we protect your data</h2>
        <p>
          We take the security of your data seriously, particularly your health
          and body information.
        </p>
        <ul>
          <li>
            Data is encrypted in transit between your device and our servers
            using industry-standard TLS.
          </li>
          <li>Data stored on our servers is encrypted at rest.</li>
          <li>
            Access to our production systems is limited to those who need it to
            operate the service, protected by multi-factor authentication on our
            hosting console, and logged.
          </li>
          <li>
            Your data is scoped to your account. Every request is authorised
            against your own identity before any data is returned. Coaches can
            only see the data of clients who have given explicit consent, and
            only the categories described above.
          </li>
          <li>
            Coach access to client health and fitness data is recorded in an
            access log, so we can tell you who has viewed your information.
          </li>
          <li>
            Technical error reports sent to our error-monitoring provider are
            automatically scrubbed to remove personal information.
          </li>
        </ul>
        <p>
          No system can be guaranteed completely secure. If we ever become aware
          of a breach affecting your personal data, we will assess it promptly
          and, where the law requires, notify the Information Commissioner's
          Office and you.
        </p>

        <h2>Data retention</h2>
        <p>
          We keep your data for as long as your account is active. When you
          request deletion, your account is deactivated immediately and
          scheduled for permanent deletion 30 days later. During that 30-day
          window you can restore your account by signing back in and confirming
          when prompted — your data is not removed until the window ends.
        </p>
        <p>
          If you don't sign back in, your account and associated personal data —
          workouts, nutrition logs, progress and personal records, custom
          workouts and recipes, your goals and habits, your health and body
          measurements, your subscription record, and your profile including
          your profile photo — are permanently deleted once the 30 days have
          passed. The record of your consent to coach sharing, and the log of
          when a coach accessed your data, are deleted along with your account.
        </p>
        <p>
          A limited amount of information is kept for longer, or on a separate
          clock, where we are required to keep it or need it to protect our
          position:
        </p>
        <ul>
          <li>
            <strong>Transaction and subscription records</strong> — we keep the
            event records our payment and subscription providers send us when
            you subscribe, renew or cancel. Depending on the event, these can
            include your account identifier, the plan purchased, your billing
            email address, and the type and last four digits of a card used for
            a historic subscription. We keep them for at least six years from
            the end of the relevant financial year, because our tax and
            accounting obligations require it.
          </li>
          <li>
            <strong>Coach access records</strong> — the log of when a coach
            accessed your data is kept so that we can answer any question you
            raise about who has seen your information. We remove records older
            than 12 months periodically, and the log is deleted in full with
            your account.
          </li>
          <li>
            <strong>Apple Health activity and sleep data</strong> — where you
            have granted permission for us to read it, we remove records older
            than 12 months periodically, and delete them in full with your
            account.
          </li>
          <li>
            <strong>Records relating to a legal claim or dispute</strong> —
            retained until the matter is resolved and any applicable limitation
            period has expired.
          </li>
        </ul>
        <p>
          These records are kept to the minimum necessary and are not used to
          rebuild your account or profile.
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
          signing back in during that window and confirming restores your
          account, and no further action is taken. You can withdraw consent to
          coach sharing at any time by removing your coach. You may also contact
          us to exercise any of these rights.
        </p>
        <p>
          We will respond to any request about your rights within one month of
          receiving it. If your request is complex or you have made several, we
          may need up to a further two months, and we will tell you if that is
          the case.
        </p>
        <p>
          We do not make any decision about you based solely on automated
          processing that has a legal effect or otherwise significantly affects
          you. The outputs of the AI features described above — nutritional
          estimates, extracted recipes, suggested exercise substitutions and
          coach summaries — are suggestions you and your coach can review and
          change, and are not decisions of that kind.
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

        <h2>Cookies and the Persistence website</h2>
        <p>
          Our website stores one thing in your browser: whether you chose the
          light or dark theme. It sets no cookies at all.
        </p>
        <p>
          We do not use analytics, advertising or tracking cookies, and we do
          not allow third parties to set cookies on our site. Because we set
          nothing that requires your consent, there is no cookie banner to
          dismiss.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If we change this policy we will update the "Last updated" date above,
          and where the change is significant we will tell you in the app.
          Previous versions are retained in our records and are available on
          request.
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

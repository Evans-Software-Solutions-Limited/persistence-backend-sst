import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

// [08-profile-settings shell refresh 2026]
// Header chrome moved to <HeaderBar> + <IconBtn> foundation primitives and
// the top safe-area inset is applied to a plain container (replacing the
// SafeAreaView top edge). Static legal body kept on its StyleSheet per the
// cosmetic-refresh scope. Behaviour + testIDs unchanged.
// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).

/**
 * Privacy Policy — pure presenter. Static legal content; no data dependencies.
 * The route file uses this presenter directly with an `onBack` handler bound to
 * `router.back()`.
 *
 * ⚠ 2026-08-03 — the body copy is NO LONGER the legacy port. The legacy text
 * (`persistence-mobile/app/privacy-policy.tsx`, "Last Updated: January 2025")
 * had drifted into a *different document* from the hosted policy: it described
 * analytics providers we do not use, and carried no legal bases, no
 * coach-sharing section and no transfer position. Two contradicting live privacy
 * policies is itself a UK GDPR Art 5(1)(a) accuracy breach, so content parity
 * beats port fidelity here. Layout, styles, props and testIDs are untouched.
 *
 * The age floor is 13 (DPA 2018 s.9), Brad's call on 2026-08-03 with the App
 * Store content rating left at 9+. That combination means the service is
 * "likely to be accessed by children", so the Children's Code applies — a
 * separate workstream, NOT satisfied by this copy.
 *
 * This screen and `packages/web/src/pages/Privacy.tsx` are two copies of the
 * SAME document. Change both together, or neither. Both have tests pinning the
 * legally-weighted claims, so a one-sided edit fails CI rather than shipping a
 * second divergence.
 *
 * ONE deliberate divergence: the hosted copy carries a "Cookies and the
 * Persistence website" section and this one does not. An in-app screen sets no
 * website cookies, so the section would be meaningless here. That is the only
 * content difference; anything else is a bug.
 */

export type PrivacyPolicyPresenterProps = {
  onBack: () => void;
};

export function PrivacyPolicyPresenter({
  onBack,
}: PrivacyPolicyPresenterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderBar
        title="Privacy Policy"
        leading={
          <IconBtn
            icon={<IconBack {...iconDefaults({ size: 20 })} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Go back"
            testID="privacy-policy-back"
          />
        }
      />

      <ScrollView style={styles.content} testID="privacy-policy-scroll">
        <Text style={styles.lastUpdated}>Last Updated: 7 August 2026</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Who we are</Text>
          <Text style={styles.bodyText}>
            Persistence (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is
            operated by Evans Software Solutions Limited, a company registered
            in England and Wales (company number 16938357), whose registered
            office is 320 Loughborough Road, West Bridgford, Nottingham, NG2
            7FB. Evans Software Solutions Limited is the data controller
            responsible for your personal data.
          </Text>
          <Text style={styles.bodyText}>
            We are registered with the UK Information Commissioner&apos;s Office
            (ICO). Our ICO registration number is ZC204325.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Who can use Persistence</Text>
          <Text style={styles.bodyText}>
            Persistence is intended for users aged 13 or over. We do not
            knowingly collect personal data from anyone under that age.
          </Text>
          <Text style={styles.bodyText}>
            If you are under 18, please talk to a parent or guardian before
            sharing your health or body information with a coach — a coach you
            connect with will be able to see your body measurements.
          </Text>
          <Text style={styles.bodyText}>
            If you are a parent or guardian and believe your child under 13 has
            created an account, please contact us at
            admin@evans-software-solutions.com and we will delete the account
            and its data promptly. If we become aware that an account belongs to
            someone under 13, we will delete it and the associated data without
            undue delay.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Information we collect</Text>
          <Text style={styles.listItem}>
            • Account details — your email address and, if you choose Sign in
            with Apple, the identifier Apple provides.
          </Text>
          <Text style={styles.listItem}>
            • Workout data — the workouts, sessions, sets, reps, exercises and
            personal records you log.
          </Text>
          <Text style={styles.listItem}>
            • Nutrition data — meals, food entries, calories and macronutrients
            you record.
          </Text>
          <Text style={styles.listItem}>
            • Photos &amp; images — meal photos you submit for AI-assisted food
            logging, and any photo you set as a profile picture. See section 5
            for what happens to the photos you submit.
          </Text>
          <Text style={styles.listItem}>
            • Health &amp; body metrics — measurements such as body weight and
            body fat, and, where you grant permission, data read from Apple
            Health or Health Connect. This is special-category (health) data
            under UK data protection law, which we process only with your
            explicit consent.
          </Text>
          <Text style={styles.listItem}>
            • Food preferences — the allergens you tell us to avoid, any dietary
            pattern you choose (such as vegetarian, vegan, gluten-free, halal or
            kosher), foods you dislike or like, and how much effort you want a
            meal to take. Allergen information is health data, and a dietary
            pattern may reveal a religious or philosophical belief — choosing
            halal or kosher, or vegetarian or vegan. Both are special-category
            data, which we process only with your explicit consent. You can
            change or clear these at any time.
          </Text>
          <Text style={styles.listItem}>
            • Goals &amp; progress — the goals, habits and progress information
            you create.
          </Text>
          <Text style={styles.listItem}>
            • Technical data — limited diagnostic information about your device
            and errors or crashes in the app, used to keep the service secure
            and reliable.
          </Text>
          <Text style={styles.bodyText}>
            Your profile picture is served from a public web address so that it
            can be displayed to coaches and other users you connect with. It is
            not listed, indexed or published anywhere else, but it is not
            protected by a password — you can remove your profile picture at any
            time.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            4. How we use your information
          </Text>
          <Text style={styles.bodyText}>
            We use your data to provide the core features of the app: storing
            and displaying your workouts, nutrition and progress; syncing your
            data across your devices; and, where applicable, sharing it with a
            coach or trainer you have explicitly connected with. We do not sell
            your personal data, and we do not use it for advertising.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            5. AI features and what they do with your data
          </Text>
          <Text style={styles.bodyText}>
            Several features in the app use an AI model to interpret something
            you have given us. In every case the processing is carried out by
            our AI provider (Amazon Web Services) in UK or EEA regions, and
            nothing you send is used to train AI models, ours or anyone
            else&apos;s.
          </Text>
          <Text style={styles.listItem}>
            • Food logging from a photo — the meal photo you capture is analysed
            to estimate its nutritional content.
          </Text>
          <Text style={styles.listItem}>
            • Food logging from a description — if you type what you ate, or ask
            us to match an ingredient, that text is analysed to estimate its
            nutritional content.
          </Text>
          <Text style={styles.listItem}>
            • Recipes from a photo — the image you provide is analysed to
            extract the ingredients and method.
          </Text>
          <Text style={styles.listItem}>
            • Equipment scanning and workout adaptation — a photo of your gym is
            analysed to identify the equipment available, and your workout and
            the equipment list are used to suggest substitute exercises.
          </Text>
          <Text style={styles.listItem}>
            • Meal suggestions — when you ask us to suggest a meal that fits
            your remaining targets for the day, we send those targets, a
            shortlist of foods, the foods you have said you like, your chosen
            effort level, and any note you add about what you fancy. Your
            allergens and dietary or religious patterns are applied on our
            servers to build that shortlist — they are not themselves sent to
            the AI provider. Every suggestion is then re-checked against your
            allergens and patterns on our servers before you see it.
          </Text>
          <Text style={styles.listItem}>
            • Meal plans — when you ask us to build a day&apos;s meal plan, or
            to swap a single meal within one, we send your daily targets, a
            shortlist of foods, the foods you have said you like, your chosen
            effort level, and any note you add. As with meal suggestions, your
            allergens and dietary or religious patterns are applied on our
            servers to build that shortlist — they are not themselves sent to
            the AI provider — and every meal is re-checked against them on our
            servers before you see the plan.
          </Text>
          <Text style={styles.listItem}>
            • Coach summaries — if you have consented to share your data with a
            coach, your coach can generate a written summary of your recent
            progress. To produce it we send your first name, your weight and
            goal weight, your personal records, and your recent training,
            nutrition and habit adherence to our AI provider. Unlike the
            features above, the summary that comes back is stored, so your coach
            can read it again without regenerating it. When the coaching
            relationship ends — whether you leave your coach or they remove you
            — every summary about you is deleted at that moment, so nothing
            reappears if you later reconnect. Summaries are also deleted with
            your account.
          </Text>
          <Text style={styles.bodyText}>
            The images and text you submit are not stored. They are held only in
            memory for as long as the analysis takes, and are then discarded —
            there is no photo library of your meals, recipes or gym on our
            servers. What is kept is only the result you choose to save (for
            example the nutritional values in your food log), the coach summary
            described above, and the link to any recipe you imported, which we
            keep on the saved recipe so you can find the original.
          </Text>
          <Text style={styles.bodyText}>
            Importing a recipe from a link does not involve AI. When you give us
            a recipe&apos;s web address, our servers fetch that page on your
            behalf and read the recipe data the site publishes in a
            machine-readable format. Because the request comes from our servers
            rather than your device, the site you named sees a request from us,
            not from you. No AI model is involved, and we do not keep a copy of
            the page — only the ingredients and method you choose to save, and
            the link itself.
          </Text>
          <Text style={styles.bodyText}>
            Everything these features produce is a suggestion, not a
            measurement. You can review and change any value before saving it,
            and no decision is taken about you on the basis of an AI output
            alone.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            6. Legal bases for using your data
          </Text>
          <Text style={styles.bodyText}>
            Under UK data protection law we must have a legal basis for
            processing your personal data. We rely on the following:
          </Text>
          <Text style={styles.listItem}>
            • Performance of a contract (Article 6(1)(b)) — we process your
            account, workout, nutrition, goal and progress data in order to
            provide the app you have signed up for, and to manage your
            subscription.
          </Text>
          <Text style={styles.listItem}>
            • Explicit consent (Article 9(2)(a)) — some of what you give us is
            special-category data: your health and body metrics, the allergens
            you ask us to avoid, and — in your dietary patterns — information
            that may reveal a religious or philosophical belief. We process all
            of it, and share it with a coach where you choose to, only on the
            basis of your explicit consent, which you can withdraw at any time.
          </Text>
          <Text style={styles.listItem}>
            • Legitimate interests (Article 6(1)(f)) — we process limited
            technical data to keep the app secure and reliable, to diagnose
            errors and crashes, to prevent fraud and abuse of our service, and
            to defend legal claims. We have considered your rights and interests
            in each case and have concluded that this processing is necessary
            and does not override them. You can object to this processing at any
            time by contacting us.
          </Text>
          <Text style={styles.listItem}>
            • Legal obligation (Article 6(1)(c)) — we retain certain records,
            such as transaction records, where the law requires us to.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            7. Sharing data with your coach
          </Text>
          <Text style={styles.bodyText}>
            If you connect with a coach or trainer inside the app, you will be
            asked to give explicit consent before any of your data is shared.
            With your consent, your coach can see: your body measurements
            (including weight and body fat), your workout sessions and personal
            records, your nutrition totals, and your goals and habits. Your raw
            Apple Health or Health Connect data (such as sleep, heart rate and
            steps) is never shared with your coach.
          </Text>
          <Text style={styles.bodyText}>
            You can withdraw this consent at any time by removing your coach in
            the app, which immediately stops all further sharing. We keep a
            record of when you gave and withdrew consent, and a record of when a
            coach accessed your data, so we can answer any request you make
            about who has seen your information.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>8. Third-party services</Text>
          <Text style={styles.bodyText}>
            We rely on a small number of trusted providers to operate the app.
            Each processes only the data needed for its function:
          </Text>
          <Text style={styles.listItem}>
            • Supabase — authentication and database hosting.
          </Text>
          <Text style={styles.listItem}>
            • Apple — all subscription purchases made in the app are processed
            by Apple through In-App Purchase. We never see or hold your card
            details.
          </Text>
          <Text style={styles.listItem}>
            • RevenueCat — subscription and purchase management.
          </Text>
          <Text style={styles.listItem}>
            • Stripe — card payment processing for any subscription paid
            directly rather than through the App Store, such as an arrangement
            made with us through our website. Stripe handles the card details;
            we never see or store them.
          </Text>
          <Text style={styles.listItem}>
            • Expo — delivery of push notifications.
          </Text>
          <Text style={styles.listItem}>
            • Amazon Web Services (AWS) — hosting, and the AI processing behind
            the features described in section 5.
          </Text>
          <Text style={styles.listItem}>
            • Sentry — error and crash reporting to help us keep the app
            reliable. Technical error data is automatically scrubbed to remove
            personal information before it is sent.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            9. Where your data is stored and international transfers
          </Text>
          <Text style={styles.bodyText}>
            Your personal data is stored and processed within the United Kingdom
            and the European Economic Area, including the AI processing
            described in section 5. We have configured our providers to store
            and process data in UK or EEA regions.
          </Text>
          <Text style={styles.bodyText}>
            Some of our providers are based outside the UK, and their support or
            engineering teams may need to access data from another country in
            order to operate or troubleshoot the service. Where that happens,
            the transfer is protected by one of the safeguards recognised under
            UK data protection law: the UK International Data Transfer
            Agreement, the UK Addendum to the European Commission&apos;s
            standard contractual clauses, or a finding of adequacy by the UK
            government in respect of the destination country.
          </Text>
          <Text style={styles.bodyText}>
            You can ask us for more detail about the safeguards applying to a
            particular provider by contacting us at
            admin@evans-software-solutions.com
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>10. How we protect your data</Text>
          <Text style={styles.bodyText}>
            We take the security of your data seriously, particularly your
            health and body information.
          </Text>
          <Text style={styles.listItem}>
            • Data is encrypted in transit between your device and our servers
            using industry-standard TLS.
          </Text>
          <Text style={styles.listItem}>
            • Data stored on our servers is encrypted at rest.
          </Text>
          <Text style={styles.listItem}>
            • Access to our production systems is limited to those who need it
            to operate the service, protected by multi-factor authentication on
            our hosting console, and logged.
          </Text>
          <Text style={styles.listItem}>
            • Your data is scoped to your account. Every request is authorised
            against your own identity before any data is returned. Coaches can
            only see the data of clients who have given explicit consent, and
            only the categories described above.
          </Text>
          <Text style={styles.listItem}>
            • Coach access to client health and fitness data is recorded in an
            access log, so we can tell you who has viewed your information.
          </Text>
          <Text style={styles.listItem}>
            • Technical error reports sent to our error-monitoring provider are
            automatically scrubbed to remove personal information.
          </Text>
          <Text style={styles.bodyText}>
            No system can be guaranteed completely secure. If we ever become
            aware of a breach affecting your personal data, we will assess it
            promptly and, where the law requires, notify the Information
            Commissioner&apos;s Office and you.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>11. Data retention</Text>
          <Text style={styles.bodyText}>
            We keep your data for as long as your account is active. When you
            request deletion, your account is deactivated immediately and
            scheduled for permanent deletion 30 days later. During that 30-day
            window you can restore your account by signing back in and
            confirming when prompted — your data is not removed until the window
            ends.
          </Text>
          <Text style={styles.bodyText}>
            If you don&apos;t sign back in, your account and associated personal
            data — workouts, nutrition logs, progress and personal records,
            custom workouts and recipes, your goals and habits, your health and
            body measurements, your food preferences, your subscription record,
            and your profile including your profile photo — are permanently
            deleted once the 30 days have passed. The record of your consent to
            coach sharing, and the log of when a coach accessed your data, are
            deleted along with your account.
          </Text>
          <Text style={styles.bodyText}>
            A limited amount of information is kept for longer, or on a separate
            clock, where we are required to keep it or need it to protect our
            position:
          </Text>
          <Text style={styles.listItem}>
            • Transaction and subscription records — we keep the event records
            our payment and subscription providers send us when you subscribe,
            renew or cancel. Depending on the event, these can include your
            account identifier, the plan purchased, your billing email address,
            and the type and last four digits of a card used for a historic
            subscription. We keep them for at least six years from the end of
            the relevant financial year, because our tax and accounting
            obligations require it.
          </Text>
          <Text style={styles.listItem}>
            • Coach access records — the log of when a coach accessed your data
            is kept for up to 12 months, so that we can answer any question you
            raise about who has seen your information. Records older than 12
            months are deleted automatically each night, and the log is deleted
            in full with your account.
          </Text>
          <Text style={styles.listItem}>
            • Apple Health and Health Connect activity and sleep data — where
            you have granted permission for us to read it, this is kept for up
            to 12 months. Older records are deleted automatically each night,
            and all of it is deleted with your account.
          </Text>
          <Text style={styles.listItem}>
            • Records relating to a legal claim or dispute — retained until the
            matter is resolved and any applicable limitation period has expired.
          </Text>
          <Text style={styles.bodyText}>
            These records are kept to the minimum necessary and are not used to
            rebuild your account or profile.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>12. Your rights</Text>
          <Text style={styles.bodyText}>
            Under UK data protection law you have the right to access, correct
            or delete your personal data; to restrict or object to how we
            process it; to receive a copy of it in a portable format; and, where
            we rely on your consent, to withdraw that consent at any time.
          </Text>
          <Text style={styles.bodyText}>
            You can access and update your information from within the app. You
            may request deletion of your account at any time from your profile
            settings, which starts the 30-day process described above — signing
            back in during that window and confirming restores your account, and
            no further action is taken. You can withdraw consent to coach
            sharing at any time by removing your coach. You may also contact us
            to exercise any of these rights.
          </Text>
          <Text style={styles.bodyText}>
            We will respond to any request about your rights within one month of
            receiving it. If your request is complex or you have made several,
            we may need up to a further two months, and we will tell you if that
            is the case.
          </Text>
          <Text style={styles.bodyText}>
            We do not make any decision about you based solely on automated
            processing that has a legal effect or otherwise significantly
            affects you. The outputs of the AI features described in section 5 —
            nutritional estimates, extracted recipes, suggested exercise
            substitutions, meal suggestions and coach summaries — are
            suggestions you and your coach can review and change, and are not
            decisions of that kind.
          </Text>
          <Text style={styles.bodyText}>
            If you have a concern about how we handle your data, you have the
            right to lodge a complaint with the Information Commissioner&apos;s
            Office (ICO), the UK supervisory authority, at
            ico.org.uk/make-a-complaint or by calling their helpline on 0303 123
            1113. We would, however, appreciate the chance to address your
            concerns first, so please do contact us before approaching the ICO.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>13. Changes to this policy</Text>
          <Text style={styles.bodyText}>
            If we change this policy we will update the &quot;Last Updated&quot;
            date above, and where the change is significant we will tell you in
            the app. Previous versions are retained in our records and are
            available on request.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>14. Contact us</Text>
          <Text style={styles.bodyText}>
            If you have any questions about this policy or your data, please
            contact us at admin@evans-software-solutions.com
          </Text>
          <Text style={styles.bodyText}>
            The current version of this policy is also published at
            persistence.evans-software-solutions.com/privacy
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  lastUpdated: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: color.$text3,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 8,
  },
  listItem: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginLeft: 16,
    marginBottom: 4,
  },
});

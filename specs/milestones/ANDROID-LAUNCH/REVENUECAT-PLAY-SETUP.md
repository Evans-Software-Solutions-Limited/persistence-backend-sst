# RevenueCat + Google Play Billing launch checklist

Code is fail-closed until the Google public SDK key and live Play products are
available. No Google credential JSON belongs in this repository.

## 1. Application and merchant setup

1. Create the Play Console app with package
   `com.bradleyevans96.persistence`.
2. Complete the linked merchant payments profile, identity, bank, tax and payout
   verification.
3. Upload the first signed AAB to Internal testing. Use the EAS `play-testing`
   profile: it keeps the production Play package while using staging API/Auth.

## 2. RevenueCat Google app

1. In the existing RevenueCat project, add a Google Play app for
   `com.bradleyevans96.persistence`.
2. Put its client-safe `goog_…` public key into the EAS `preview` and
   `production` environments as `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
3. Create a Google Cloud service account, grant the Play app:
   - View app information and download bulk reports.
   - View financial data, orders and cancellation survey responses.
   - Manage orders and subscriptions.
4. Upload that service-account JSON directly to RevenueCat. Never add it to EAS
   build environment variables or source control.
5. Configure Google Play Real-Time Developer Notifications / Pub/Sub for
   RevenueCat, then send and confirm a test notification.

## 3. Product contract

Create these six Play subscription IDs:

- `app.persistence.premium`
- `app.persistence.premium_plus`
- `app.persistence.trainer.individual`
- `app.persistence.start_up_coach_plus`
- `app.persistence.coach`
- `app.persistence.coach_pro`

Each subscription has two active auto-renewing base plans named exactly:

- `monthly`
- `annual`

Do not use opaque period IDs such as `p1m` / `p1y`: the shared client product
mapper receives `subscriptionId:basePlanId` and uses `annual` to classify the
billing cycle.

Import all twelve base plans into RevenueCat. Attach monthly + annual products
to the matching existing entitlement lookup keys:

| Play subscription                     | RevenueCat entitlement |
| ------------------------------------- | ---------------------- |
| `app.persistence.premium`             | `premium`              |
| `app.persistence.premium_plus`        | `premium_plus`         |
| `app.persistence.trainer.individual`  | `individual_trainer`   |
| `app.persistence.start_up_coach_plus` | `start_up_coach_plus`  |
| `app.persistence.coach`               | `coach`                |
| `app.persistence.coach_pro`           | `coach_pro`            |

Attach each Google base-plan product to the equivalent existing package in the
RevenueCat `default` offering. Configure trials as Google Play offers; the app
reads the selected offer's pricing phases rather than using Apple's eligibility
API.

## 4. EAS submission credential

Upload a Google Play service-account key to EAS Credentials for
`com.bradleyevans96.persistence`. This key is for store submission and may be a
separate least-privilege service account from RevenueCat's order-management
credential.

The workflows intentionally use `releaseStatus: draft`:

- staging Android → `play-testing` profile → Play Internal track draft;
- production Android → `production` profile → Play Production track draft.

## 5. Acceptance matrix

Test on a physical Play-enabled Android device with a license-tester account:

- monthly and annual purchase for every tier;
- eligible trial and returning/ineligible customer copy;
- purchase cancelled by the user;
- pending/delayed payment, then completion while the app is backgrounded;
- bank-app verification and successful return to Persistence;
- restore after reinstall and after signing into a second Persistence account;
- renewal, cancellation, grace period, account hold, expiry and refund;
- Google Play management link;
- RevenueCat customer identity equals the Supabase user ID;
- RevenueCat webhook and `POST /subscriptions/sync` update the backend tier;
- no entitlement is granted while a purchase remains pending.

Promote only after the Play Console AAB shows a supported Billing Library,
`com.android.vending.BILLING`, target API 36, and all twelve products are
returned by the `default` offering.

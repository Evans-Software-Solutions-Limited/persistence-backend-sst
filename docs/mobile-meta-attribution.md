# Mobile Meta attribution and privacy release notes

## Decision and data boundary

Meta app-install/activation measurement is optional advertising tracking. The
lawful basis is UK GDPR consent, with PECR consent obtained before SDK storage
or identifier access. The default is off. Refusal cannot affect startup,
authentication, onboarding, purchases or entitlements, and consent can be
withdrawn. On iOS, Persistence asks for ATT only after its own plain-language
opt-in; an ATT refusal means the Meta SDK is not initialized. The consent copy
names the device advertising identifier used for this measurement.

The plain-language choice is mounted beside (not inside) the authentication
gate so a clean-install opening can be attributed. It is a dismissible native
alert and never withholds the React tree or any auth/onboarding work; choosing
"Not now" records denial and the app continues unchanged.

The native integration has no generic event API. Automatic events stay disabled
to prevent Meta from observing in-app purchases. The adapter emits only Meta's
parameter-free `fb_mobile_activate_app` event for first-open/install attribution.
It must never receive
health or nutrition data, workouts, exercises, loads, DOB, names, free text,
email, Supabase/RevenueCat IDs, or any other raw internal identifier.

RevenueCat webhooks remain authoritative for trial, purchase, renewal,
cancellation and entitlement delivery. The app does not send these events to
Meta, so there is no client/server purchase double-counting or event-ID scheme
to maintain. The existing consent-gated web CAPI, `/store-click`, and
`AppStoreClick` conversion are unchanged.

## Configuration and verification

Set both `EXPO_PUBLIC_META_APP_ID` and `EXPO_PUBLIC_META_CLIENT_TOKEN` at native
build time. If either is absent, the Expo plugin is omitted and runtime is a
silent no-op. The planning IDs below are **not verified by this repository**:

- Business portfolio `1110614147901157`
- Web dataset `persistence` / `2072560130045942`
- Mobile app `persistence-mobile` / `1502579917743484`

Before building, the owner must verify the mobile app ID and client token in
Meta App Dashboard, and confirm that iOS bundle ID
`com.bradleyevans96.persistence` and Android package
`com.bradleyevans96.persistence` are attached to that app. Do not reuse the web
dataset ID as the mobile app ID.

Before release, on physical iOS and Android devices:

1. Confirm no Meta request or storage occurs before consent, after refusal, or
   with configuration absent.
2. Confirm iOS ATT appears only after the Persistence opt-in and refusal leaves
   the app fully usable.
3. Confirm install/activation in Meta Events Manager Test Events for a clean
   install; check diagnostics and app/platform association.
4. Reconfirm RevenueCat sandbox purchases emit only the authoritative webhook
   analytics path, while web `AppStoreClick` still works.

## Store disclosures to update before submission

App Store Connect: mark tracking as used, disclose device/advertising IDs and
product interaction for third-party advertising/advertising measurement as
applicable to Meta's observed payload, and keep health/fitness, purchases,
name, user content and user ID marked **not used for tracking by Meta**. The
privacy nutrition labels must be reconciled against an actual device capture.

Play Console Data safety: disclose Meta SDK collection/sharing observed on a
consented physical-device run (normally device or other identifiers and app
interactions for advertising/analytics), state collection is optional, and
retain the existing purchase disclosure for RevenueCat. Verify deletion and
encryption declarations against Meta's current SDK behavior.

No store build may be submitted without explicit owner approval.

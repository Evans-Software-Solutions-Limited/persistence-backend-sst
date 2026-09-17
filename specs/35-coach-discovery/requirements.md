# Coach discovery — requirements

15 September 2026 · Discussion draft; not signed off.

## Acceptance criteria

- **AC1:** Eligible subscribed coaches can opt into a directory within their existing subscription, without a listing surcharge. Default is hidden. Ineligible, suspended and opted-out listings disappear from search and detail access.
- **AC2:** Coaches choose online/in-person/hybrid, town/area or public business venue, bio, specialties, photo and accepting-clients status. Discoverability and availability are independent; unavailable coaches remain visible with enquiries disabled.
- **AC3:** Athletes search online or by selected area/radius, browse stable paginated results and inspect allowed public details. Manual search needs no device-location permission. Approximate distances and empty results are explained. Free-athlete browsing is proposed, pending confirmation.
- **AC4:** Authenticated enquiries support response, decline and withdrawal without creating a coaching relationship or sharing health data. Deduplication, rate limits, reports and blocks prevent repeat contact abuse.
- **AC5:** Connection requires the existing mutual acceptance/data-sharing consent and capacity checks. Availability cannot bypass seat limits. Hiding a listing leaves existing client relationships intact.
- **AC6:** Public responses exclude private profile/health data and unverified qualification claims. Track result-bearing searches, details, enquiries, accepted connections and response time.

## Scope history

The original 15 September brief proposed the complete listing/search/enquiry/connection flow, included in existing subscriptions. This remains the proposed coordinated scope. Coaching payments, reviews, booking calendars and sponsored ranking remain outside scope. GPS-assisted search is optional and undecided.

## Execution amendment — 17 September 2026

The user authorized finalizing and merging the briefs. The following engineering defaults resolve draft options; they are not individually asserted user decisions or evidence of implementation. This amendment supersedes conflicting draft wording.

- **AC7:** All authenticated athletes, free or paid, may browse. Eligible active coach subscriptions include publishing without surcharge. Listings start hidden. Online, in-person and hybrid modes are supported; location uses public venue/town/coarse area only. Foreground location is optional with manual fallback; no background tracking.
- **AC8:** Only the owning coach changes a listing. Version checks reject stale writes; identical mutation retries never duplicate enquiries, consent, relationships or notifications. Hide/expiry/block changes take effect on the next server read and before any contact/connection transaction commits.
- **AC9:** Search has bounded radius and page size with query-bound cursors, approximate distances and no private-location or health fields. Unauthenticated callers cannot enumerate listings. Changed availability disables contact without necessarily hiding a listing.
- **AC10:** Accepted enquiry means permission to continue discussing, never consent or access. Connection requires fresh affirmative athlete consent and creates/reuses a client-initiated pending request; the coach subsequently accepts under the existing seat lock. Blocked, expired or no-longer-accepting races must fail without granting access.
- **AC11:** Denied/revoked location, offline browsing and stale results are explicit states. Private contact and publication actions require online server acknowledgement; no offline queue may silently replay consent/contact. The complete feature passes the mapped smoke test before release. Brad owns any native build.

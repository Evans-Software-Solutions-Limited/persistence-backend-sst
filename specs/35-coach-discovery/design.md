# Coach discovery — design

Discussion draft.

## D1. Listing and access

Use a dedicated listing model and explicit allowed-field public projection; never return full profiles. Extend existing coach-profile UI with discoverability, delivery mode, service area and availability controls. Validate role and effective coach subscription centrally, including grace/expiry. Directory eligibility does not verify professional qualifications.

Authenticated listing read/update operations enforce ownership. Search/detail operations filter opted-out, expired, suspended and blocked accounts; invalidate cached projections when eligibility/visibility changes. Existing relationships remain independent of directory visibility.

## D2. Search and location

Resolve manually selected town/venue to provider place ID and coarse coordinates; provider/cost selection precedes implementation. Bound search radius, page size and filters; use stable distance/ID pagination. Online-only listings never imply proximity. Show approximate distances for area centers.

Mobile search/result/detail containers use application queries and directory ports, with HTTP adapters and pure presenters. Handle no results, stale availability and denied optional location access. Manual selection needs no location permission. Foreground GPS would require a new Brad-built binary because the current app lacks its native dependency/configuration; check actual runtime before promising OTA delivery.

## D3. Enquiry and connection

Dedicated create/list/respond/withdraw enquiry operations store minimal messages and pending/accepted/declined/withdrawn status. Enforce authentication, deduplication, bounded rate limits, availability, blocks and reporting. Notifications carry minimal information.

An accepted enquiry begins the existing invitation/relationship acceptance and explicit data-sharing consent flow; it never independently activates access. Recheck seat capacity at connection. Reuse current invite-code, relationship-response and seat services rather than introducing alternate consent rules.

## D4. Evidence and rollout

Test tier/ownership matrix, visibility revocation including caches, radius boundaries/pagination, availability races, duplicate requests, blocked contact, seat caps, consent boundaries and unchanged existing relationships. Verify mobile listing-to-connection flow and empty states. Pilot with opted-in coaches; a genuine connection is the success signal. No native build is authorized by this draft.

## D5. Execution contract — 17 September 2026

This section supersedes undecided options in D1–4. All routes use authenticated JWT identity; caller IDs never come from bodies. Responses use `{data: ...}`; errors `{code,message}` with 400 validation, 401 authentication, 403 entitlement/ownership, 404 inaccessible resource, 409 version/state conflict and 429 rate limit. Existing relationship routes retain their current error contracts.

### Models and storage

`CoachListing`: coachId, version (positive integer), discoverable (default false), mode (`online|in_person|hybrid`), placeId (nullable, required for in_person/hybrid), displayName (1–80), bio (0–1000), specialties (max 10 strings, each 1–50), photoAssetId (nullable owner-controlled approved image), acceptingClients (boolean), updatedAt. Resolve placeId server-side; never accept public coordinates/home address from a listing body. No invented verified qualification badge. Public projection contains coachId, version, displayName, bio, specialties, safe photo URL, mode, place label/coarse center, acceptingClients and rounded distanceKm when applicable. No contact email, relationship, health or private-profile data.

`CoachEnquiry`: UUID id, athleteId, coachId, message (1–1000), status (`pending|accepted|declined|withdrawn`), version, timestamps, nullable relationshipId. One open pending/accepted enquiry per pair; terminal enquiries have a 7-day recontact cooldown. Enquiry records are visible only to the two participants. Shared block state excludes results/contact in either direction. Safety reports use the shared reporting primitive and never expose reporter identity to the subject.

Backend owns dedicated listing/enquiry repositories, validation/services and migrations. Enforce unique coach listing/open pair and mutation receipts transactionally. RLS denies direct anonymous/authenticated table access; authenticated API service access must enforce actor and projection rules explicitly. No reliance on elevated DB credentials for authorization. Serialize shared `packages/db/src/schema.ts`, migration numbering and `microservices/core/src/api.ts` mounting with the integration owner.

### Exact HTTP surface

| Method and route                               | Input                                                                                                                          | Output / transition                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/coach-directory/me/listing`              | none; coach only                                                                                                               | own listing or null                                                                                                                        |
| PUT `/coach-directory/me/listing`              | full editable listing fields above plus `expectedVersion` (0 for creation)                                                     | listing; increment version; explicit entitlement required to publish; owners may hide after expiry                                         |
| GET `/coach-directory`                         | `mode` (online, in_person or hybrid), optional `placeId`, `radiusKm` (1–100, default 25), `cursor`, `limit` (1–50, default 20) | `{items,nextCursor}`; online matches online/hybrid, in_person matches in_person/hybrid, hybrid matches hybrid; non-online requires placeId |
| GET `/coach-directory/:coachId`                | none                                                                                                                           | sanitized accessible listing                                                                                                               |
| POST `/coach-directory/:coachId/enquiries`     | `{message}`                                                                                                                    | enquiry; 201 first creation, existing open enquiry returned on duplicate pair without overwriting message                                  |
| GET `/coach-directory/me/enquiries`            | `role` (athlete or coach), `cursor`, `limit` (1–50, default 20)                                                                | participant's `{items,nextCursor}` ordered createdAt/id descending                                                                         |
| POST `/coach-directory/enquiries/:id/respond`  | `{action,expectedVersion}`; action is accept or decline; target coach only                                                     | pending → accepted/declined, increment version                                                                                             |
| POST `/coach-directory/enquiries/:id/withdraw` | `{expectedVersion}`; athlete only                                                                                              | pending/accepted → withdrawn, increment version                                                                                            |
| POST `/coach-directory/enquiries/:id/connect`  | `{consent:true,consentVersion,expectedVersion}`; athlete only                                                                  | accepted → accepted with relationshipId, increment version; `{enquiry,relationshipId,status}`                                              |

Every write requires `Idempotency-Key` (UUID). Store receipt keyed by actor, method/route and key with request hash in the same transaction for 7 days. Same payload returns recorded result after current authorization/safety checks; changed payload returns 409. Database pair/relationship uniqueness prevents duplication beyond receipt expiry. Suppress notification duplication using committed event identity/outbox. New contact limit: 5/hour and 20/day per athlete; 429 includes Retry-After. Bound listing writes/responses at 60/hour per actor; message bodies never enter analytics.

Search cursors are signed, expire after 15 minutes and bind caller, normalized filters and last distance/coachId (name/coachId for online). Membership changes may remove results but cannot re-expose hidden/blocked rows; this is stable keyset ordering, not a frozen snapshot. Re-filter every page/detail against current eligibility, visibility and blocks. Round displayed distances to whole kilometres. Private reads use no-store; mobile must refresh directory on foreground/detail navigation and clear inaccessible projections. Provider exact coordinates must not leak through projections or telemetry.

### Shared dependencies

Train Together owns `GET /places/search?q&cursor&limit` (`q` 2–100 characters; limit default 20/max 50) and `Place={placeId,label,center:{latitude,longitude}}` with a coarse locality/venue centroid, shared social blocks/reports and mobile foreground permission/location adapter. Consume those contracts; do not create duplicate geocoding, safety or native permission stacks. Search requests use placeId, never persist athlete GPS. The shared location adapter consumes `GET /places/nearby?latitude=&longitude=&cursor=&limit=` to offer coarse place options from optional foreground GPS. Coordinates remain ephemeral and excluded from logs, analytics and storage; only a deliberately selected placeId/display metadata persist. Both place endpoints follow Train Together D9; the provider contract and credentials are integration gates. Fixture adapters permit parallel progress until dependencies land.

### Consent and races

Extract/reuse the transaction/service behind `application/trainers/invite-codes/trainersAcceptInviteCodeHandler.ts` to create a client-initiated pending request with `recordDataSharingConsent`; the directory must not fabricate or expose an invite code. Fresh consent uses the current spec-28 version. Record source as directory connection through the existing consent system. Reuse matching pending/active pair without duplicate relationship or consent grants on retry; terminated pairs follow existing revival rules. An already active relationship returns its status and grants no new access.

`application/trainers/relationships/trainersRespondToClientRequestHandler.ts` remains the subsequent coach acceptance path and seat-lock authority. Enquiry acceptance alone is not that action. Directory-origin pending requests retain origin/enquiry linkage so subsequent acceptance can recheck accepted (not withdrawn) enquiry status, current blocks, listing eligibility and availability under the same transaction/locking boundary as connection. Withdrawal of an enquiry with a linked pending request terminates that directory-origin pending request transactionally; an already active relationship is untouched. Lock/read the relevant listing and safety state consistently with concurrent hide/block updates; fail closed with 409 when contact is no longer allowed. Expiry/withdrawal never removes existing active relationships or silently changes existing consent.

## D6. Mobile implementation and evidence

Under `packages/mobile/src`, add pure directory models/ports, application commands/queries, HTTP and in-memory adapters, directory search/detail/enquiry/profile containers and props-only presenters. Thin navigation screens link athlete discovery and coach profile controls. Reuse existing coach consent and pending-request UI. Maintain listing/enquiry expected versions; conflicts refresh and ask the user to retry deliberately. Do not auto-retry contact with changed payload. Draft editing may persist locally; publication, response and consent require online acknowledgement (explicit exception to generic offline-write guidance).

Tests map AC1/7 to entitlement matrix, AC2/8 to stale writes/hide/availability, AC3/9 to radius/cursor/blocked projection, AC4/8 to duplicate and rate-limit races, AC5/10 to consent and concurrent final-seat acceptance, AC6 to forbidden-field and telemetry assertions, AC11 to denied-location/offline/container-adapter UI. Track searches with results, detail views, unique enquiries, response latency and actual activated connections without coordinates, messages or health data. Screenshot actual UI and run integrated smoke; fixtures alone do not establish release readiness.

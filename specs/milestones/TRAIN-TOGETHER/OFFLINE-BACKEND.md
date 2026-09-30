# Offline identity and owner recovery

This slice follows merged PR #474. It prepares authenticated local admission and
server recovery for PER-64. It does not activate Together or provide native peer
transport. The mobile journal still needs wiring into the workout flow.

## Trust boundary

An authenticated account registers a device public key with proof of possession.
The server signs a bounded device credential; peers receive that credential and
the public key, never the account's Supabase bearer token or a server signing
secret. Verification keys must be cached from the trusted server before going
offline. A key supplied by an untrusted peer cannot become its own trust root.

Credentials and pair-specific friendship evidence expire within 24 hours. This
is an engineering freshness bound, not a promise of immediate offline revocation.
Clients must refuse new shared admission after expiry, on a locally known block,
or when the trusted clock/key material cannot be established. Personal logging
and recovery remain available. Refreshing credentials requires connectivity.
Offline support assumes an earlier authenticated setup on the device; it cannot
create a new authenticated account without internet.

The host serializes the roster, with at most four distinct athletes including
the host. A guest signs deliberate consent bound to the session, host and own
execution. Valid pair evidence permits accepted friends to join without a
separate product approval. Strangers require the host's explicit approval.
Neither path grants PREV visibility or permission to log another person's sets.
The native adapter must bind proof of device-key possession to its fresh
connection challenge; a captured credential is not a transport handshake.

## Recovery boundary

Recovery is authenticated as the owner. The host cannot upload another
athlete's execution. Stable session, execution and command identities survive
transport changes. Exact retries are safe; reuse of an identity for different
content is a conflict. Missing revisions must not silently overwrite newer data.

Server recovery preserves a review candidate, separate from live cloud
membership and workout history. A server receipt means the recovery payload is
stored; it does not mean a workout result, PR or streak has been created. Do not
discard the owner's journal based on that receipt. Recovered data remains private
to its owner even when a sharing credential has expired or a peer relationship
has changed.

The subsequent completion slice must let the athlete review recovery, update the
same stable workout result, and recompute dependent effects without duplicates.
It must cover host finish-all, save-own/end-sharing, solo continuation and empty
results. Until that integration exists, the UI must not present server recovery
as a completed save to workout history.

## Remaining release evidence

- Native secure device-key storage and an authenticated, replay-resistant peer
  handshake using fresh challenges.
- Local-radio and same-Wi-Fi/hotspot adapters, including no upstream internet.
- Mobile journal dispatch, review UI and accurate local/peer/server receipt states.
- Explicit transition between local coordination and cloud sessions, with one
  authority for roster/closure and stable owner identities.
- Physical mixed iOS/Android four-person tests, restart/partition/replay tests,
  and deployed PostgreSQL concurrency evidence. Brad owns native builds.

Keep the feature off until these and the existing moderation/pilot gates pass.

## Deployment configuration

`TogetherOfflineAuthority` is a server-only SST secret, supplied by the
`TOGETHER_OFFLINE_AUTHORITY` GitHub environment secret in both deployment
workflows. Its JSON shape is `{keyId, privateKey, publicKeys}`: `privateKey` is
the active Ed25519 private PEM and `publicKeys` maps key IDs to trusted SPKI
public PEMs. The active pair must match. An empty secret is valid for a stage
where offline support has not been configured; credential operations fail closed.
Never commit real key material or send the secret object to clients.

On rotation, replace the active private key/key ID and retain previous public
verification keys for outstanding recovery. Removing an old public key prevents
verification of its outstanding credentials. Clients fetch public verification
material over the authenticated server connection before using it offline; peer
payloads never replace this trusted cache. Native key storage and refresh policy
remain part of the mobile integration gate.

## Backend contract

All endpoints use the existing authenticated Together feature boundary. Mutations
require a UUID `Idempotency-Key`. Account identity comes from verified server auth,
not the uploaded body.

| Endpoint                                      | Purpose                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /together/offline/trust`                 | Obtain public authority verification keys over the trusted server connection.                       |
| `POST /together/offline/devices`              | Register/refresh a device credential using a signed registration bound to this account and request. |
| `DELETE /together/offline/devices/:deviceId`  | Revoke this account's device for subsequent online authorization.                                   |
| `POST /together/offline/friendship-proof`     | Issue bounded evidence for one accepted friend pair without publishing a friend list.               |
| `POST /together/offline/recovery`             | Store signed owner commands and reconstruct a private review candidate.                             |
| `GET /together/offline/recovery/:executionId` | Read the authenticated owner's reconstructed recovery candidate.                                    |

Recovery binds the plan, session, execution and workout `startedAt` once. Every
signed command binds the actor, command ID and expected personal revision to that
same identity. Batches contain at most 100 commands and apply atomically; a gap or
conflict must not leave an acknowledged partial import. The
response explicitly separates `stored_for_review`, `sharingActive: false` and
`historySaved: false`. Import does not create an active cloud group. Reusing a
cloud session ID for this independent offline path is rejected; a later authority
transition protocol must explicitly reconcile that case.

The native client must port the signed-payload encoding exactly and validate wire
fixtures before exchanging peer payloads. Server-side verification utilities do
not by themselves implement an iOS/Android peer connection or persist a roster on
the phone.

Signed UUIDs must use canonical lowercase spelling. For signature bytes, the
reference implementation recursively sorts object keys using `requestHash`,
preserves array order, and serializes with JavaScript `JSON.stringify`. It hashes
the UTF-8 JSON with SHA-256, then signs the UTF-8 string
`persistence-together-signature-v1:<lowercase hash hex>` with Ed25519. Signatures
use unpadded base64url. Clients must match number/string encoding as well as key
order; ordinary platform JSON serialization is not sufficient evidence.
The public interoperability fixture is
`microservices/core/src/application/together/__tests__/offline-wire-vector.json`.
It includes canonical JSON, preimage, public key and signature, with no production
key material. The test verifies it independently through Node's crypto API.

# Together physical-device acceptance — 5 October 2026

**Not executed by this source handoff.** Use the compatible binary and test-stage
configuration supplied by Brad; prerequisites and exact flags/migrations are in
[TEST-READINESS](./TEST-READINESS.md). Agents must not start native, prebuild, EAS,
mobile build or deployment workflows. Release availability is now authorized in
source; actual builds and deployments remain Brad-owned.

For every case record commit/binary/runtime, OS/device models, selected transport,
account entitlement fixtures, Internet/local-network state, timestamps, actual
result and screenshots. Do not record token/private-key values. A simulated pair
of screens or successful SDK send is not synchronization/durable-delivery evidence.

## Transport matrix

Run each applicable row with **2, 3 and 4 paid athletes**, with an accepted-friend
pair and a stranger requiring host approval. Attempt a fifth athlete explicitly.

| Transport                      | Physical cases                                                                                             | Required observation                                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same-network LAN               | iOS↔iOS, Android↔Android, iOS↔Android on ordinary Wi-Fi; repeat on router without Internet                 | Signed verified host selection, explicit Join, four-person maximum; Internet absence does not prevent an already authorized session.                                                                                                      |
| Joined hotspot LAN             | Phones joined to a manually enabled iOS/Android hotspot; disable cellular Internet while retaining hotspot | Same reachable network only; independently logged sets and reconnect remain correct. Record actual hotspot/OS behavior.                                                                                                                   |
| Explicit Android hotspot-owner | Android owner plus iOS/Android clients, manually enabled AP; compare ordinary LAN mode                     | Explicit owner mode works only on permitted directly connected local routes. No silent fallback; record OEM NSD/routing failures honestly.                                                                                                |
| Nearby                         | Both same-platform directions and iOS↔Android, with and without Internet; Wi-Fi/Bluetooth changes          | Real discovery, authenticated connection and bounded fragmentation. Record actual radios/media; do not infer use of the physical hotspot from proximity alone.                                                                            |
| Cloud friends/invitation       | Internet available, then interrupted/resumed; 2/3/4 paid users                                             | Pending approval and independent executions survive retry; no worldwide directory, no automatic fallback to a LAN session. Removal/leave frees a concurrent seat; racing replacement admissions must still cap the active roster at four. |

## Product and failure cases

| Case                                                                                                  | Expected result                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Warm credential cache, then airplane mode with required local radios restored                         | Paid host/friend/stranger behavior remains authorized offline; all users deliberately Join. Discovery endpoint/name/SDK acceptance alone never establishes identity.                                                                                                                                                                                         |
| Cold cache offline; expired credentials; free/expired subscription; account/API-environment switch    | Honest preparing/unavailable/renewal state and no sharing bypass. Cached identity cannot cross accounts/environments. Personal draft logging and reviewed own recovery remain available.                                                                                                                                                                     |
| Deny/regrant local network, Bluetooth/Nearby Wi-Fi and applicable Android location permissions        | Clear permission failure, cleanup and explicit retry; no phantom lobby or background permission escalation. Repeat on supported Android API levels.                                                                                                                                                                                                          |
| Private invite vs open local lobby                                                                    | Private host absent from anonymous browse; forwarded bearer invitation only provides eligibility. Accepted friends join explicitly without extra approval; strangers remain pending; declined/full/cancelled states retain personal drafts.                                                                                                                  |
| Existing guest sets; explicit keep-own vs adopt/append shared template                                | No discarded sets or relabelled prior history. Replace-empty refuses any existing set row. Independent plan IDs, rest and skip remain correctly owned.                                                                                                                                                                                                       |
| Host 80 kg vs guest 60 kg, different substitutions/rest/skips                                         | Own values and eventual histories stay independent. With numbers private, only bounded plan completion/skip progress appears. No reps/weights/PREV leakage.                                                                                                                                                                                                  |
| Numeric, PREV and logging grants separately; revoke during send and disconnect                        | Only selected owner/recipient receives each capability. Revocation purges cached private data; disconnected cached grants cannot restore access on reconnect. Friendship/admission confers none of these grants.                                                                                                                                             |
| Partner edits a rendered set while owner edits the same execution                                     | Stale revision reports conflict; never retries against an unseen newer revision or overwrites the owner's set. Repeat while owner backgrounds/signs out during delivery.                                                                                                                                                                                     |
| Host removes an athlete; removed athlete tries old invite/friendship/reconnect                        | Signed removal reaches remaining peers and clears revoked caches. Removed athlete continues personally; old proof does not auto-readmit them. Remaining athletes keep sharing. Cloud capacity is four concurrent athletes including the host; removal frees a seat for a different deliberate join, while the removed athlete cannot rejoin the old session. |
| Drop network/radio, background, force-stop/restart, disconnect during approval; return foreground     | Durable own work survives. Old callbacks/frames cannot resurrect credentials or sessions. Reconnect authenticates a fresh channel; link/private-cache state is honest.                                                                                                                                                                                       |
| Host finish-all vs save-own; guest leave; another athlete has unsent work                             | Only acknowledged state is claimed. Other athletes' private results are not falsely marked saved. Each athlete can review their own candidate and finish independently.                                                                                                                                                                                      |
| Lose cloud create/join/finish response; retry; reject pending request; explicit continue personally   | Stable request identity, no orphan cloud marker routed to solo completion, no duplicate history. Unknown outcomes remain recoverable; detach only after a definitive safe outcome and durable personal persistence.                                                                                                                                          |
| Log offline, expire credentials, reconnect for own-result review; drop upload/accept response         | Original owner key signs retained work without reauthorizing sharing. Exact reviewed candidate accepted once; review changes invalidate stale acceptance. Personal result/history effects are not duplicated.                                                                                                                                                |
| Add/change a slot after signed-plan promotion, including after first-set deletion                     | No historical slot relabelling. Unsupported differences pause sharing, remain visible in local checkpoint and appear as review omissions. Partial save retains those differences for personal continuation.                                                                                                                                                  |
| Person code/QR, request/accept/remove friend, block during session, report; copy template twice       | Codes reveal no account ID; deliberate request/accept. Blocks stop authorized access and purge partner cache while preserving own work. Copy is independent and contains no private results; retry creates no duplicate.                                                                                                                                     |
| Slow peer, fragmented/maximum frames, 8 pending native peers, repeated discovery, stale/forged frames | Bounds/timeouts fail closed, healthy peers continue, no unsolicited admission. Transport send success never becomes full-journal/server receipt.                                                                                                                                                                                                             |
| Ordinary solo workout and a fresh personal workout after confirmed Together finish                    | Existing local logging, completion/history and PR behavior remain intact, including after clock correction.                                                                                                                                                                                                                                                  |

Measure at least 100 accepted foreground updates on a stable connection and record
sample size/p95 against the existing ≤2-second target. Compare visible state on each
device with authoritative own history, including reconnect and retry. Record
failures explicitly and rerun affected cases after fixes.

Release sign-off still requires the PR's full automated gates, reviewed-design
screenshots, clean local Inspector, owner-built runtime compatibility, this device
matrix and operational/moderation ownership. No CI Inspector run is authorized by
this checklist. Lower-priced tiers and coached classes are not part of this test.

## Release update gate

- Install a compatible 1.1.3 release binary: Together is available without developer
  flags. With cached valid credentials, lose Internet and confirm LAN still works.
- Deliver a higher minimum policy to that binary: only Update/Check again remain;
  foreground/retry/offline must not reopen the app from an older cached policy.
- Confirm store links target the installed production app; internal variants show
  installation guidance for the testing distribution, not the production store.
- Verify an old native version or missing required native module is blocked even
  when the OTA manifest claims a newer JS version. Preserve local workouts.
- Record the separate compatible bootstrap rollout for pre-gate 1.1.2 clients;
  this source cannot retroactively install a gate in an already-installed binary.

## Staging follow-up: delegation, membership and recovery races

Use four paid test accounts and retain each athlete's independent result IDs.
Automated fault-injection tests cover these races; repeat the user-visible paths
on Brad-built devices before physical sign-off.

- Delegate a set while the owner's workout is temporarily unavailable; restore
  the same workout and confirm the pending set applies once. Simulated storage
  failure must retain the intent without spinning or displaying success.
- Queue writes from two partners, then disconnect/remove one. The remaining
  partner's pending write must survive. Removing several peers must clear every
  peer's cached state even when one simulated persistence operation fails.
- Finish a guest's own result, then leave. Remaining clients must refresh their
  membership and consent state; repeating leave must not revoke newly granted
  consent again.
- Remove an athlete who continues privately. Their own edits and completion must
  remain available to them without sending activity/revision events to the other
  athletes. Confirm independent history contains one result.
- Create a revision conflict and immediately finish, before the polling interval.
  Changed authority must require a fresh review; Review again then finish must
  work. An offline refresh must not resend a stale completion.
- Promote an older retained personal workout. Its original start and PREV cutoff
  must survive while the new cloud session's creation time reflects creation now.
- On a release build, verify missing required native modules block initialization
  and emit a diagnostic identifying the missing modules when Sentry is enabled.
  Development/web remain unaffected. This needs a deliberately prepared owner
  build; the automated module fixture is not binary-linkage proof.
- In staging policy configuration, raise and then correct an erroneous minimum.
  Check again must recover after a valid lower policy response, including after
  app restart. Do not ask users to reinstall and risk local workout data.

Deployment rollback accepts true/false, 1/0 and on/off, ignoring surrounding
whitespace and case. An unrecognised explicit setting aborts configuration rather
than silently enabling Together. An unset value remains enabled as approved.
No build, live policy change or deployment is performed by this checklist.

- While privately continuing after removal, delay a cloud refresh, save an own
  set, then deliver the older refresh. The acknowledged set remains unchanged;
  a later refresh agrees with it even though the group revision did not move.
- On another signed-in device, remove an exercise substitution. Refresh the
  first device: the original exercise/name returns, and editing a set does not
  reinstate the substitution.
- Attempt a first cloud join into a full lobby or with an invalid invitation.
  A conclusive rejection must offer explicit personal continuation, preserving
  all notes/sets. A lost or ambiguous response must retain its original retry
  key and must not permit detachment that could duplicate an admitted workout.

### Large history and permission follow-up

- Join online with an empty local cache: own relevant previous sets hydrate before
  the original workout start; no other athlete history appears without PREV consent.
- Join without internet with cached credentials/history: admission and cached PREV
  still work. Change account or leave while hydration is pending; no late publication.
- Share 50 exercises ×5 sets, then a maximum supported snapshot. Verify complete
  recipient display only after transfer, no host plaintext for guest-to-guest sharing,
  and independent progress while transfer runs. Measure device throughput separately.
- Revoke PREV during host relay, interrupt Wi-Fi, reconnect and retry. No partial or
  revoked history appears; current authorized state restores after reconnect.
- Skip an exercise before granting PREV; remaining exercises still share correctly.
- Current target 36: exercise existing Nearby permission denial/retry and LAN/hotspot.
  On a future target 37 build running Android 17+, verify local-network denial,
  grant, cancellation and retry for both paths. iOS: local-network/Bluetooth denial,
  Bonjour discovery and camera Together QR prompt on physical devices.

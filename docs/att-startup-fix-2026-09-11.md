# ATT startup fix

Implemented locally for the build 50 review issue. No native build, OTA update,
store submission, or review reply has been published.

## Behaviour

- Notification requests and ATT share an iOS permission queue. This covers
  startup notifications, push registration, saved-consent restoration and
  the advertising measurement control in Privacy Settings.
- Each request waits until the app has been active continuously for 300ms.
  The queue waits for the previous native request to finish before proceeding.
- An undetermined ATT response retries at most twice, for three native
  attempts per activation. A denial stops immediately. Exhausted attempts
  leave measurement disabled and return `pending`; Settings explains that
  no decision was returned, rather than treating it as a refusal.
- Native/storage failures leave the existing consent choice intact and the
  SDK disabled. They no longer persist a false denial.
- Withdrawal cancels an ATT request waiting for foreground or its queue turn.
  If a native sheet is already open, its queue slot remains occupied until
  the native promise settles; the cancelled activation cannot start Meta.
- Android retains its explicit opt-in requirement and does not use the iOS
  queue. Existing saved denials are preserved: they cannot safely be
  distinguished from legitimate refusals, so there is no consent reset.

The service owns native retries. The startup hook still starts one bounded
activation per mount; it does not loop indefinitely or re-prompt after denial.

## Evidence

All checks below ran locally. Native permission responses in tests are mocked;
the integration tests run the actual hooks, notification adapter, attribution
service and permission queue.

| Check                             | Result                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused permission/consent tests  | 142 passed, 8 suites                                                                                                                                                  |
| Original-service regression check | All 5 new startup regressions fail against the original service; fixed service restored afterwards                                                                    |
| Full repository unit-test command | Exit 0; 21 Turbo tasks successful, 18 cached                                                                                                                          |
| Mobile suite in that run          | 530 suites, 6,835 tests passed                                                                                                                                        |
| Repository type-check             | Exit 0; 9 tasks successful                                                                                                                                            |
| Repository lint                   | Exit 0; existing warnings remain                                                                                                                                      |
| Repository build                  | Exit 0; mobile script delegates to EAS                                                                                                                                |
| iOS JavaScript export             | Exit 0; output at `/tmp/persistence-att-ios-export`                                                                                                                   |
| Repository formatting             | Blocked only by pre-existing formatting in `docs/appearance-audit-2026-09-10.md` and `docs/transactional-email-discovery-2026-09-10.md`; those files were not changed |

Changed runtime-file coverage (statements / branches / functions / lines):

| File                            | Coverage                      |
| ------------------------------- | ----------------------------- |
| `nativePermissionQueue.ts`      | 100 / 100 / 100 / 100         |
| `expo-notifications.adapter.ts` | 100 / 100 / 100 / 100         |
| `metaAttribution.ts`            | 99.04 / 96.42 / 100 / 98.94   |
| `useMetaAttribution.ts`         | 96.96 / 95 / 100 / 100        |
| `PrivacySettingsContainer.tsx`  | 94.44 / 92.10 / 92.30 / 95.65 |

The diagnostic harness from the investigation has been replaced with acceptance
regressions in
`packages/mobile/src/application/analytics/__tests__/startupPermissions.test.tsx`.
It covers pending notification → ATT sequencing, an unanswered ATT request
followed by a grant, the retry limit, exception recovery on a later mount,
inactive saved-grant restoration, and cancellation while backgrounded. Queue
tests also cover reversed ordering, stabilization resets, aborts and errors.

Existing Jest metadata and React `act` warnings remain non-failing. During
implementation, fixture isolation and an async test declaration were corrected
before the final passing runs.

## Before resubmission

Build a new native iOS binary with the production Meta configuration. The
previous artifact could not be downloaded for inspection; the JavaScript
export is not proof of the shipped Info.plist or SDK network behaviour.

On a physical device, preferably matching Apple's iPadOS 27 review environment:

1. Record launch from a fresh install, the system ATT dialog, and the following
   sign-in/onboarding flow. Do not add a custom tracking pre-prompt.
2. Test granting and denying notifications, then granting and denying ATT.
   Verify that no permission sheets overlap and refusal leaves the app usable.
3. Background and foreground the app during startup and between permission
   requests. Check saved-grant restoration and Privacy Settings withdrawal.
4. Confirm Meta does not initialize or transmit tracking data before consent or
   after refusal, using native/network evidence rather than Jest results.
5. Attach the recording to the App Review reply and reference it in App Review
   Information notes. Describe the app-side sequencing correction and the
   observed result; do not attribute the issue to the reviewer's account.

The paired iPhone was running iOS 26.6.2 during investigation. No physical
iPadOS 27 recording or native visual verification has been completed.

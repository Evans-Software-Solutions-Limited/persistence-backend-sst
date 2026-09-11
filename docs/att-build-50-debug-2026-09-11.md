# Build 50: ATT startup investigation

Update: the fixes described below are now implemented locally. The original
diagnostic harness was promoted into acceptance regressions at
`packages/mobile/src/application/analytics/__tests__/startupPermissions.test.tsx`.
The diagnostic results and code references below describe the pre-fix snapshot.
See `docs/att-startup-fix-2026-09-11.md` for current validation and release status.

The strongest explanation is an application startup race, not a problem with
the reviewer's account. Notification permission and ATT are requested without
coordination. ATT can be suppressed while notifications await a decision; our
hook then abandons the attempt. This is a demonstrated JavaScript failure path
consistent with Apple's documented behaviour, not a reproduction of the
reviewer's physical iPad session.

## What shipped

Live EAS metadata identifies [build 50](https://expo.dev/accounts/bradleyevans96/projects/persistence/builds/69bd7acb-9ede-4e46-a09a-736512eaa43f)
as version 1.1.2, production channel/runtime 1.1.2, completed September 10 at
09:54 UTC. Commit: `7f5fdbe58da6f594b134a4bc229cb622a4aff461`.
The ATT fix `96215378` is an ancestor; its hook and service are unchanged from
the reviewed local HEAD `10aa973b`. The latest production iOS OTA is August 17,
runtime 1.1.1, commit `5c060ccb`, so that update cannot override this build.

The build artifact download returned HTTP 403. Actual binary Info.plist and
embedded Meta configuration remain unverified. The source enables the plugin
and `extra.metaConfigured` only when both Meta build environment variables are
present. Build metadata alone does not prove these values were included.

## Findings

1. **High: competing first-launch permission requests.**
   `packages/mobile/app/_layout.tsx:453` mounts notification, Meta and push
   bootstraps as siblings. `useNotificationPermissions.tsx:107` requests
   notifications while `useMetaAttribution.ts:45` can request ATT independently.
   There is no shared completion signal or permission coordinator. The RN
   active-state snapshot is not a lock: a notification request can already be
   pending before its inactive event reaches JS. The installed Expo ATT native
   module forwards straight to Apple's API on the main queue; it supplies no
   cross-permission scheduling. Additionally, `usePushNotifications.tsx:96`
   can make another notification request when authentication resolves while
   permission is still undetermined. A fix must include that caller.

   [Apple's API documentation](https://developer.apple.com/documentation/AppTrackingTransparency/ATTrackingManager/requestTrackingAuthorization%28completionHandler%3A%29)
   says the app must be active, another pending permission prevents the prompt,
   concurrent requests are not preserved, and undetermined status should be
   checked to decide whether another request is necessary.

2. **High: suppressed ATT is never retried during the mounted session.**
   `useMetaAttribution.ts:44` sets `requested = true` before awaiting a result,
   discards that result, and removes its active listener before the call.
   `metaAttribution.ts:112` correctly leaves undetermined consent unchanged,
   but returns `failed`; no caller schedules another attempt. Dismissing
   notifications or foregrounding the app does not recover. A fresh mount can
   retry unknown consent, which explains why a later launch may behave
   differently from the first one.

3. **Medium: technical failure is persisted as a user refusal.**
   `metaAttribution.ts:149` writes `denied` for any exception, including an
   exception from the ATT request before the user has answered. The next
   bootstrap skips ATT because of that stored denial. Its adjacent comment
   claiming ATT was already granted is incorrect for this path. The second
   permission-status probe also returns false on exceptions and can cause the
   denial branch to run despite an undetermined initial response. Preserve
   non-consent and report technical failure separately from an explicit refusal.

4. **Medium: restoring a saved grant bypasses the active-state gate.**
   `bootstrapMetaAttribution()` calls the grant function at
   `metaAttribution.ts:212`, before the hook's active-state logic. If local
   consent is granted but system ATT is undetermined and the app is inactive,
   it makes an unpresentable request. Bootstrap still returns the stored grant,
   causing the hook to skip recovery. This is a restore/reset edge case,
   independent of the clean-install notification race.

All four diagnostic cases leave `Settings.initializeSDK()` uncalled. That
confirms fail-closed behaviour at this application boundary, not the absence
of all native SDK traffic in the shipped binary.

## Reproduction evidence

The existing tests isolate the hooks; the root layout test mocks them all.
The ATT hook test also mocks the grant result as `true`, although the real
service returns `activated`, `declined` or `failed`. None exercise the actual
two-hook permission interaction.

Commands run from `packages/mobile`:

```sh
bun run test --runInBand --watch=false --runTestsByPath src/ui/hooks/__tests__/useMetaAttribution.test.ts src/ui/hooks/__tests__/useNotificationPermissions.test.tsx src/application/analytics/__tests__/metaAttribution.test.ts
# Test Suites: 3 passed, 3 total
# Tests: 52 passed, 52 total

bun run test --runInBand --watch=false --testMatch '**/debug/att-startup.repro.tsx'
# Test Suites: 1 passed, 1 total
# Tests: 4 passed, 4 total

bun run typecheck
# tsc --noEmit, exit 0
```

`packages/mobile/debug/att-startup.repro.tsx` is an explicitly selected
diagnostic harness: passing means it reproduces today's defects, not that
the product is correct. It runs the real hooks and attribution service with
in-memory storage and controlled native responses. Its notification case
delays consent storage hydration until the notification request has started
while RN still reports active; after an undetermined response it delivers
inactive/active events and confirms only one ATT call occurred. The remaining
cases demonstrate lost retry, durable false denial and inactive restoration.
It is outside normal test discovery and should be replaced by acceptance
regressions when implementing the fix.

The harness initially required corrections to its comment syntax and storage
mock before executing successfully; those setup failures were not product
findings. Jest also emits the existing `_testTimeout_note` config warning.

No booted simulator was available. Installed runtimes are iOS 18.6 and 26.4;
the paired physical iPhone runs iOS 26.6.2. No iPadOS 27 physical reproduction
or recording was performed. No device permissions were reset.

## Recommended correction

Use one permission sequence for notification bootstrap, push registration and
ATT. Finish the first request and wait for active state before attempting ATT;
route saved-grant restoration through the same sequence. Make pending ATT
(`undetermined`) a distinct outcome with a bounded lifecycle-driven retry;
never loop or retry an actual refusal. Separate operational failure from
persisted consent and retain the SDK's fail-closed gate. Record local/native
diagnostics for request start/end, app state, permission status and SDK
initialization without identifiers, so the next physical run provides evidence.

Validate notification allow/deny, both request timing orders, ATT allow/deny,
background/foreground, restored consent, native errors and Android's existing
explicit opt-in. Then capture Apple's requested fresh-install physical-device
flow and check native network activity before permission. The review reply
should describe our correction and evidence; it should not blame Apple's
account or device settings.

Scope of this investigation: diagnostic harness and notes only. No production
application changes, database changes, build, publication or review reply.

INSPECTOR_VERDICT: FINDINGS

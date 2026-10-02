# PER-64 / PER-22 — provisioned LAN lobby integration

This slice starts from merged main `97c7769e` (PR #482). Together remains
**disabled in production**: both provisioning and lobby factories default to
false, and AppProviders does not enable either. No native/prebuild/EAS build,
deployment, activation or physical-device test is included.

## What is connected

The reviewed slim Together entry row is an optional slot below SessionHeader.
The lobby container mounts its BottomSheet at screen root, outside the workout
list. Dismiss returns to personal logging while retaining the lobby; explicit
Leave cancels sharing. Coached/on-behalf and retrospective workouts do not mount
this capability. Personal workout storage and completion commands are unchanged.

Host preparation obtains an account/environment-scoped verified credential and
signs a bounded invitation containing the session, host account/device and workout
name. Guests paste or scan this invitation, verify it against provisioned issuer
keys, and separately choose Join. Only then does same-LAN discovery locate the
pinned session; its endpoint ID cannot establish identity. The encrypted handshake
must prove the pinned host account/device. No peer-supplied issuer keys are used.

The merged roster/admission engine supplies actual membership: accepted friends
with verified friendship evidence auto-admit after deliberate Join; strangers
require host approval. All four seats include the host. Full/declined responses
travel inside the authenticated channel. Joining grants neither PREV access nor
permission to log for another athlete. Every athlete requires a qualifying paid
credential; an invitation never grants a free seat.

The friendship API distinguishes an unblocked nonfriend from an authorization or
block refusal. Missing friendship permits the approval route; genuine refusals
remain fail-closed, including previously learned pair denials offline. Credential
preparation, expiry, unavailable keys, permissions/network isolation, unreachable
host, approval, capacity and reconnect states are represented separately.

Internet reachability is a provisioning refresh hint, not a LAN gate. Connection
loss allows explicit reconnect with the same immutable consent/execution identity.
Cancellation, account replacement and leaving foreground invalidate outstanding
operations, serialize native stop/start ownership and clear retained key copies.
Backgrounding terminates this foreground-only lobby; it does not silently resume
sharing. Admitted cancellation closes that local session; failed discovery before
admission can retry the same invitation. Owner journals remain available.

## Reviewed visual reference

Source: [sole reviewed Together v2 prototype](https://claude.ai/artifact/FPeZDi5As7URgXtT1J5sM1)
and [approved amendments](https://linear.app/evans-software-solutions/document/together-reviewed-claude-ux-and-approved-implementation-changes-7970adc93c8b).
There were no Together presenters/routes in current main: the existing reviewed
experience was the prototype, while merged runtime code was adapter-only.

Reuse: SessionHeader/SessionExerciseCard remain intact; existing BottomSheet, Btn,
Card, Geist typography and theme tokens supply the row, invitation entry and
separate consent card. Approved additions are same-network connection copy,
verified-account selection, pending/full/unavailable/reconnect and stranger
approval. UI says lobby connected and keeps the workout personal, rather than
claiming the unwired shared-workout journey is complete. No fabricated names,
plans, counts, partner directory or automatic workout promotion are shown.

Visual evidence uses the actual React presenter in a temporary React Native Web
harness. It validates the entry/control sequence and consent-card treatment;
component regressions validate root overlay placement and dismissal behavior.
It does not establish native Gorhom geometry, camera scanning, radio operation or
physical Wi-Fi/hotspot behaviour. Reviewed prototype is dark-only; shared design
tokens retain that presentation when checked under either theme setting.

## Outstanding release work

- Verified open-lobby browsing and invite-only audience configuration; this slice
  uses explicitly shared signed invitations and bounded discovery of that host.
- Native Nearby radio; Android hotspot-owner support when no Wi-Fi Network exists.
- Workout-plan transport/promotion, logging projection, PREV/delegation/cache
  purge, completion/recovery integration and explicit local/cloud authority changes.
- Profile/name projection, broader friends/block/report UI and remote sessions.
- Compatible owner-built binaries and mixed iOS/Android four-device evidence,
  permissions, isolation/no-internet, reconnect and live infrastructure validation.

These are not an implied release or a replacement design. PER-64 and PER-22 remain open.

## Validation

Final full mobile: 556 suites / 7,348 tests. Non-mobile tests: 18/18 tasks,
including 5,449 core tests. Root typecheck 9/9, lint 6/6, non-mobile build 12/12,
formatting and whitespace checks pass. Focused real-crypto/SQLite simulated-LAN
and API tests: 293; backend repository/routes: 26. Local Inspector full-diff
re-review: CLEAN. No CI Inspector was triggered.

New integration files and changed Together runtime/backend files exceed 90% in
every coverage metric. The existing ActiveSession container and presenter remain
below the whole-file threshold, reproduced against main: container
84.51/76.87/88.13/91.82% statements/branches/functions/lines, presenter
94.05/86.84/92.50/96.66%. The slice’s new entry path and coached/retrospective
exclusion have direct regressions. No coverage exclusions were added.

A broad instrumented run overlapped other suites and timed out the existing
45-command delivery test at 20s. The isolated instrumented case passed in 7s;
the final ordinary full suite passed. This observed contention remains a caveat.
The full mobile runner also emitted an existing forced-worker teardown warning;
focused new suites exit cleanly. Native and physical-device evidence is outstanding.

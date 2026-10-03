# Together own-workout logging — PER-64 / PER-22

Scope approved 4 October 2026, after merged PR #484 (`c6a71555`). This is an
integration preview behind the existing production-disabled capability.

## Interaction and durability

An admitted athlete explicitly chooses **Use my workout in Together**. Joining
alone does not promote or share their draft. Read the latest personal draft at
that click; preserve its local ID, start time, exercises, notes, all completed
values and partial/blank sets. Each athlete uses the execution ID from their
own signed admission consent. No PREV or delegated logging permission is added.

Reuse the reviewed [Claude design](https://claude.ai/artifact/FPeZDi5As7URgXtT1J5sM1)
active workout and slim status row, plus the existing lobby cards. Extend only
for explicit promotion and honest local-save/receipt/reconnect/paused states.
Do not expose partner-view controls until their authorization/projection works.

A separate account-scoped Together SQLite checkpoint is authoritative after
promotion. It persists the full personal snapshot, original credential, immutable
canonical plan/hash, stable exercise/set IDs and ordered own intents. Signing
seeds remain in the existing identity adapter. Checkpoint and signed journal
append commit together before LAN delivery. The ordinary personal cache is a
mirror; a failed mirror cannot erase or misreport a committed checkpoint.
Reads discover the unfinished account checkpoint independently of the personal
cache, including after sign-out clears that cache. Only one unfinished promoted
workout is allowed per account; replacement and clearing are guarded.

Compatible weights/reps edits and removals use the existing signed owner-command
and durable delivery contracts. Promotion includes already logged reps/weights,
even before the personal finalizer sets `isCompleted`. Partial values stay in the
checkpoint; removing a projected value emits a removal rather than fabricated
zero values. Retries preserve IDs/version order and peer receipts remain distinct
from server acceptance.

After leave, background teardown, credential expiry or app restart, own logging
continues into the checkpoint, with unsigned intents when no live authority is
available. Recovery does not autojoin, advertise or invent a new execution.
No credential seed is stored for later signing. If the exact original authority
is still available, pending intents are signed in order before newer edits;
restart recovery needs the reviewed signing/upload flow, which is not included.

## Deliberate boundaries

Initial promotion supports ordinary in-progress strength/default-category
workouts with canonical catalog IDs and weights/reps. Empty drafts, coached or
retrospective sessions, cardio/timed sets, RPE, supersets and substitutions remain
personal. A later unsupported edit or plan change still persists the full draft
but permanently pauses its LAN projection for this slice. This is explained in
the UI; restoring fields does not silently resume sharing.

Each athlete checkpoints their current personal plan. Host-plan distribution,
partner projections and view switching remain pending. The existing four-seat,
paid-only, friend/stranger admission and authenticated LAN rules still apply.

Promoted complete/cancel attempts return `TOGETHER_COMPLETION_PENDING` before
any solo `/sessions/record` enqueue, finalization or active-pointer clear. Rating
and cancellation UI retain the draft and explain that account result saving is
not available yet. This deliberate preview limitation must be resolved before
activation; no native or production release is authorized here.

## Evidence and follow-up

Real SQLite reopen/rollback and real signing/LAN protocol tests cover preservation,
idempotent replay, independent executions, peer receipts, reconnect, account and
lifecycle races. Storage and UI tests cover authoritative reads/mirror failure,
replacement guards, fresh promotion consent and prevention of solo completion.
Browser presentation checks use the actual React Native Web presenter with
simulated snapshots; they do not prove native geometry or physical transport.
See STATE.md and the PR for executed gates and coverage.

Next: finish/recover own result through the merged server contracts, restore a
usable completed-workout lifecycle, distribute/reconcile plans and project
partners with explicit visibility/PREV/delegation. Nearby radio, Android
hotspot-owner limitations, authority transitions and two-device evidence remain
explicit outstanding work. Brad owns native/prebuild/EAS builds.

# Persistence Together — frontend agent

## Current integration — 5 October 2026

The consolidated PR on merged #485 (`bc4c34f3`) wires the reviewed lobby to
own logging/recovery, independent named partner views, shared templates,
nonnumeric progress, separate numeric/PREV/logging controls, host removal and
completion choices. Cloud friends/invitation sessions and person-code/QR partner
flows use the same explicit ownership rules. Nearby and Android hotspot-owner
source are included; compiled/device behavior is not yet established.

Use [TEST-READINESS](./TEST-READINESS.md) for exact development flags, migrations,
owner build prerequisites and limits, and [SMOKE_TEST](./SMOKE_TEST.md) for device
acceptance. Brad subsequently authorized release-build availability: the public
test flag and per-route version fallback are removed. The app-wide native update
gate requires a compatible 1.1.3 binary; backend configuration defaults enabled
with an explicit false rollback switch. No build or deployment is implied.

Keep the existing active workout/set editor, slim Together row, partner cards,
named owner switching and return-to-mine. Sharing state, projection receipts and
server result acceptance are distinct. Private numbers still show nonnumeric plan
progress; PREV and permission to log for an athlete require their separate grants.
A delegated editor must send the revision rendered on screen, never silently use
a newer revision. Removed/disconnected athletes retain personal logging/recovery.

Shared-plan adoption is explicit before promotion and preserves the athlete's
existing draft. Immutable signed plans cannot relabel previously logged slots.
Review lists unsupported local differences; partial acceptance retains the full
personal checkpoint rather than silently completing it. Cloud pending drafts
also remain authoritative; only a confirmed safe explicit personal continuation
can release them. No automatic solo save or LAN/cloud authority transition.

Older dated readiness and venue-discovery instructions below are historical;
current approved requirements and this handoff supersede conflicting statements.

## Reviewed UX — reuse, do not redesign

Brad confirmed on 1 October that the
[reviewed Claude Together v2 artifact](https://claude.ai/artifact/FPeZDi5As7URgXtT1J5sM1)
is the only Together design. Use the
[central Linear design reference](https://linear.app/evans-software-solutions/document/together-reviewed-claude-ux-and-approved-implementation-changes-7970adc93c8b)
for the screen inventory and approved amendments. Preserve the reviewed layouts,
components, slim Together strip, named ownership/view switching and return-to-mine.
Do not recreate agreed UX or replace it with a new design. Compare UI changes
against the matching original prototype screen using screenshots.

Apply approved AC15–22, including bounded nearby/same-network lobbies and
friends/invitation-based remote sessions. Extend existing screens only for the
confirmed missing consent, connection, recovery and completion states. Prototype
coached capacity, inactivity auto-save and unrestricted numeric access are not
approved behaviour. Coached distribution/scheduling remain separate tickets.
The original source export/TOGETHER_HANDOFF.md is not archived locally; the
working artifact and PER-60 are the handoff, not a reason to redesign.

Historical 1 October backend handoff: PRs #474/#475/#477 and the subsequently
merged PREV/offline foundations are reused by the current integration.
Older backend handoff and venue-discovery instructions below are historical;
the current requirements and approved lobby scope supersede them.

## Current scope — 30 September 2026

Approved AC15–20 in [requirements](../../34-train-together/requirements.md)
supersede conflicting two-person, universal host-approval and online-only scope
below. Four athletes, trusted-friend admission, explicit PREV consent, host
completion choices and fully offline nearby/Wi-Fi/hotspot support are required.
[Offline design](./OFFLINE-DESIGN.md) distinguishes proposed native transport
from proven implementation. PR #462 is merged; older evidence remains historical.
No native builds are authorized.

Backend handoff (21 September 2026): PR #462 supplies the server contracts behind
default-off flags. Consume its runtime wire examples and `TogetherApi`; do not
mount the historical recovery projection. `hostId:null` means the host account
was deleted: offer own recovery, not host controls. Canonical replay identifies
the target athlete. `DRAFT_PROMOTED` is a permanent 409 for solo queue recovery.
Private recovery copies may have a different catalog ID from the original; use
the server's returned mapping/definitions for recovered history.

## Spec alignment

Implement [design](../../34-train-together/design.md) D8–10, satisfy [requirements](../../34-train-together/requirements.md) AC1–14 and close [tasks](../../34-train-together/tasks.md) E4–5/mobile E7. Parent spec wins over this execution cut.

## Ownership and execution

Own `packages/mobile/src/` Together domain models/ports, application commands, SQLite journal, HTTP/realtime adapters and containers/presenters/routes; location configuration and reusable place selector also belong here. Backend owns wire schemas, shared catalog/schema/infra; coordinate rather than duplicating. Coach frontend consumes D9 LocationPermissionPort/PlaceSearchPort and selector.

Read D10 anchors before changes. Preserve existing solo offline completion and PR/statistics behavior. Use domain interfaces and injected in-memory adapters for development, then backend contract fixtures. No framework imports in domain; containers own effects, presenters receive props.

Implement in this order:

1. Durable promotion marker and pending-command journal with stable keys; explicit recovery for timeout, conflict, restart, logout and device switch. Do not run generic last-write-wins or enqueue solo completion after promotion.
2. Two-phone own-set logging, explicit revocable partner permission, host plan order with separate substitutions/rest/skips/finish. Display whose history changes; explicit apply-to-both gets two acknowledgements. Show pending/stale/conflict states honestly.
3. Invitation consent, approval, paid eligibility/upgrade and active-draft resolution. Retain the draft until promotion succeeds. Free friendship/discovery browsing must not imply eligibility to join.
4. Friends/request/remove/block/report; nearby opted-in expiry, honest empty states, selected-place search and optional foreground GPS. Never request background permission or publish exact device position. Manual search remains available after denial/revocation.
5. Sanitized friend plan offer and explicit independent save; finish/leave drains pending operations or presents recoverable work. A partner disconnecting must not prevent own recovery. Purge cached partner data when access ends.

## Evidence and handoff

Test domain/state transitions and restart-safe storage; presenter accessibility, offline/conflict/permission empty states; container-to-adapter contract flows; regression of solo completion. Verify screens visually using the visual-verify skill. Run formatting/typecheck/lint/relevant tests and report actual results. Follow repository conventions, not speculative new architecture.

Provide [SMOKE_TEST](./SMOKE_TEST.md) evidence on two real phones when a compatible owner-built binary exists. Mock adapters are development aids, not release evidence. Document runtime/native dependency changes and permission copy for Brad. Never trigger native/EAS/mobile builds; report physical-device evidence as blocked until supplied. No separate feature launch: friends/nearby/reuse form the same gated release.

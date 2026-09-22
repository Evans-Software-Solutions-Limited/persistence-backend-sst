# Persistence Together — frontend agent

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

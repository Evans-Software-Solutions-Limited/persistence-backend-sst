# Coach discovery — backend agent

## Spec alignment

Implement [design D5](../../35-coach-discovery/design.md#d5-execution-contract--17-september-2026), satisfy [AC1–10](../../35-coach-discovery/requirements.md), complete T2–4/T6 and backend evidence for T8. Parent spec wins.

## Ownership and work

Own new `microservices/core/src/application/coach-directory/` handlers, its service/repository implementation and tests, listing/enquiry migrations. Coordinate rather than concurrently editing `packages/db/src/schema.ts` and `microservices/core/src/api.ts`. Preserve other agents' edits.

Implement the exact D5 routes, validation, version checks, authenticated projections, transactional receipts, deduplication and rate limits. Reuse centralized coach eligibility. Implement RLS and transaction authorization together; expiry/hiding/blocking must defeat stale cached details and concurrent contact.

Extract the existing invite-code relationship service only as needed for directory consented connection; retain existing handler behavior and tests. Integrate subsequent coach response with the directory-origin checks and existing seat lock. Accepted enquiries never activate relationships. Reuse shared blocks/reports/place resolution contracts from Train Together; use fixtures until integrated, not a competing implementation.

## Required evidence

Run relevant repository formatting/typecheck/lint/unit/integration checks, plus migration safety checks against a disposable database. Test real concurrent duplicate enquiry, hide/block versus connect, stale versions, final-seat acceptance and retry after receipt expiry. Assert no health/private fields and no duplicate consent/notification/relationship rows. Execute backend portions of smoke and report live-dependency gaps. Follow local Inspector Brad gate before a PR. Do not run native builds, deploy, contact coaches or purchase providers.

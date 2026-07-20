# 25 — Coach ↔ Client Offboarding — Tasks (execution brief)

Order: backend first (B), then mobile (F). Each task lists definition-of-done.
Gates before any PR: `bun run prettier:check && bun run typecheck && bun run
lint && bun run build && bun run test:unit` (≥90% on changed files), then local
`inspector-brad` sweep.

## Backend

- [ ] **B1 — Enum + migration.** Add `relationship_terminated` to
      `actionTypeEnum` (`packages/db/src/schema.ts:228`) and a migration
      `<ts>_relationship_terminated_audit_value.sql` with a single
      `ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'relationship_terminated';`
      (mirror `20260706170000_workout_unassigned_audit_value.sql`). DoD: migration
      idempotent; typecheck passes.

- [ ] **B2 — (removed).** Hybrid model keeps habits + goals (D3); no goal/habit
      teardown method is needed. Instead, add the Decision-6 regression test under
      B3/B9 proving the offboarding leaves coach-set habits+goals active and lifts
      the coach edit-lock.

- [ ] **B3 — Shared teardown core.**
      `application/relationships/endCoachClientRelationship.ts` per design § 1.
      Single tx: conditional soft-end (race/AI/ownership guard) → delete programme
      assignments (`assignedBy=trainer, clientId`) → delete ad-hoc workout
      assignments (`trainerId, clientId`) → audit row. **Does NOT touch
      goals/habits** (D3). Returns `{ok:true,relationshipId}` |
      `{ok:false,status:404}`. DoD: unit tests for both directions, all 404 paths,
      teardown scoping, audit written, **plus the Decision-6 regression** (coach-set
      habit+goal rows survive & stay active, `isHabitCoachLocked`→false after end);
      SQL rendered via PgDialect in the delete/guard tests.

- [ ] **B4 — Post-commit notification.** After the core commits, best-effort
      in-app notification to the counterparty (client if trainer-initiated, coach
      if client-initiated) via `NotificationRepository`; try/catch, non-fatal. DoD:
      test asserts recipient per direction + that a thrown notification error does
      not roll back the teardown.

- [ ] **B5 — Coach endpoint.** `trainers/clients/trainersRemoveClientHandler.ts`
      → `DELETE /trainers/me/clients/:clientId`; mount in `api.ts`. DoD: authz test
      (only the trainer on the row), 404 paths, happy path.

- [ ] **B6 — Client endpoint.**
      `trainers/relationships/clientLeaveCoachHandler.ts` →
      `DELETE /clients/me/relationships/:relationshipId`; mount in `api.ts`. DoD:
      authz (only the client on the row), 404 for not-yours / AI-trainer / already
      ended, happy path.

- [x] **B7 — Seat/roster verification. VERIFIED, no change needed.**
      `countActiveTrainerClients` (assertEntitlement.ts) filters
      `status='active' AND is_ai_trainer=false`; `getRosterClients`
      (trainerRepository.ts:414) filters `status IN ('active','pending') AND
is_ai_trainer=false`. Soft-ending to `terminated` therefore frees the seat
      and removes the client from the roster automatically.

- [x] **B8 — Re-invite collision. VERIFIED, no change needed.** Both re-invite
      paths already revive a dormant `terminated` row in place rather than
      INSERT-colliding on the UNIQUE `(trainer_id, client_id)` index: email invite
      (`trainerRepository.ts:1332-1349`) and invite-code accept
      (`trainersAcceptInviteCodeHandler.ts:211-224`) — both UPDATE → `pending` and
      clear `end_date`. My teardown clears `end_date`? No — it sets it; the revive
      paths clear it. Compatible.

- [x] **B9 — AI-access invariance (D5). No code, covered by existing.** The
      teardown touches no `ai_access`/entitlement code (grep-verified), and
      `ai_access` is resolved from the acting user's own tier
      (`assertEntitlement.ts:424`). A client's AI access is provably unchanged
      because nothing writes it. Coach on-behalf AI (`assertEntitlement(trainerId,
"ai_access")` + `assertTrainerCanActForClient`) 403s after teardown via the
      existing status='active' guard, which already has its own tests. A dedicated
      "nothing happened" test would be low-value; documented here instead.

## Mobile

- [ ] **F1 — Ports + adapter.** `api.port.ts`: `removeClient(clientId)` +
      `leaveCoach(relationshipId)`. `sst-api.adapter.ts`: the two DELETE calls.
      DoD: adapter unit test hits the right URL/verb.

- [ ] **F2 — Coach Remove-client (AC-4.1).** Wire the dead kebab
      (`ClientDetailPresenter.tsx:323`, `testID=client-detail-more`) → action sheet
      → destructive Remove client → `Alert.alert` confirm (copy per design § 6a) →
      mutation → `goBack()` + invalidate roster/detail queries. DoD: presenter +
      container tests (renders action, confirm→mutation→invalidate/navigate, error
      path alerts).

- [ ] **F3 — Client Leave-coach (AC-4.2).** Active-trainer row
      (`ProfilePresenter.tsx:441`) exposes Leave coach → confirm (copy per § 6b) →
      mutation → invalidate trainers list + client plan/assignments. DoD: presenter
  - container tests.

## Verification / close-out

- [ ] Full gate suite green (paste output in PR).
- [ ] Local inspector-brad clean; note `🕵️ Inspector Brad (local): clean @ <sha>`.
- [ ] Update STATE.md + memory (`project_*`).
- [ ] Two PRs on a shared branch (backend + mobile) per repo execution model, or
      one PR if Brad prefers a single slice — confirm at PR time.

## Out of scope (this slice)

- Push notifications on termination · reactivation UX beyond re-invite ·
  account-deletion path · AI-access derivation changes.

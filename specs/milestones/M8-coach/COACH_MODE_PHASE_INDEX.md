# Coach Mode Completion — phase index (session launcher)

> One-screen map of the whole mandate so any phase can start cold in a fresh session. **Always read `STATE.md` first** (canonical status + gotchas), then the phase's brief/spec below. Full detail specs: `specs/10-trainer-features/{requirements,design,tasks}.md`, `specs/_shared/cross-cuts.md`, `specs/18-habit-setup/`, `specs/19-programs/`.

## Standing rules (every phase)

- Branch off latest `origin/main` (rebase before PR). Each phase = its own PR.
- **Commit with explicit pathspecs; check `git diff --cached --name-only` before committing** (pre-staged index WIP once broke a deploy — STATE.md).
- Run **repo-level `bun run prettier:check`** before the PR (the staging deploy runs `prettier --check .` over the whole tree; the PR job is change-scoped and can miss things).
- Gates: `prettier:check && typecheck && lint && build && test:unit` (backend, 90% cov / audit 95%); mobile: root `tsc -p packages/mobile/tsconfig.json`, jest from `packages/mobile`, `expo lint`.
- **Local inspector-brad sweep before every PR**; note `clean @ <sha>` in the body. Never fire the `@inspector-brad` CI action.
- Ping Brad via `slack-progress-updates` at every phase boundary / when blocked. (⚠ ntfy push is currently blocked by the session sandbox — Slack still works.)
- On-behalf writes: `assertTrainerCanActForClient` gate + `auditTrainerAction` in-tx (both in `application/relationships/`). Reference impl: `trainers/measurements/logClientMeasurement.ts`.
- Migrations: timestamp strictly after the newest in `supabase/migrations/`; **the Deploy-Staging workflow auto-applies migrations to the staging DB on merge.**

## Status

- ✅ **Phase 0** docs reconciliation — #159 MERGED.
- ✅ **Phase 1** audit foundation (`trainer_actions_audit` + helpers) — #160 MERGED.
- ✅ **Phase 2** #136 measurement reconcile — #161 MERGED.
- ✅ Hotfix CLAUDE.md prettier — #162 MERGED (staging green).
- ✅ **Phase 3** on-behalf endpoints + `notification_type` enum — #165 MERGED (2026-07-06).
- ✅ **Phase 4** Client Detail functional spec (modules a–g) — #164 MERGED, Brad signed off.
- ✅ **Phase 9** Programs mobile F1+F2 + T-19.3.5 Client Detail programme surfaces — #166 MERGED (2026-07-06). spec-19 fully shipped end-to-end.

## Open Brad decisions (don't block Phase 3; bite later)

1. **Schedule hero** — default: Coach Home v1 ships WITHOUT it (appointments deferred). Confirm. _(Phase 10.)_
2. **Invite-QR** — pure-JS QR of `persistencemobile://accept-invite?code=`; athlete redeem = a **pending** request the coach accepts (not auto-connect). Confirm. _(Phase 8.)_
3. **Calorie-hit privacy** — coach sees totals + adherence, NOT the food log? _(Phase 4 sign-off.)_
4. **Action:** commit the untracked dir-form skills `.claude/skills/{elysia-route-change,sst-resource-change}/` (deleted-on-main via #159).

## Remaining phases

| Phase  | What                                                                                                                        | Brief / authoritative spec                                                | Depends on                                                              | Surface             | Parallel-safe?               |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------- | ---------------------------- |
| **3**  | On-behalf endpoints (sessions/measurements-GET/goals/nutrition-target/workout-assignments) + `notification_type` enum ALTER | `PHASE3_ON_BEHALF_ENDPOINTS_BRIEF.md`                                     | Phase 1 ✅                                                              | backend             | ✅ independent               |
| **4**  | Client Detail **functional spec** (+ Brad sign-off)                                                                         | `PHASE4_CLIENT_DETAIL_FUNCTIONAL_SPEC_BRIEF.md`                           | —                                                                       | spec/docs           | ✅ independent               |
| **5**  | Client Detail **build** (aggregate endpoint + single-scroll, modules a–f)                                                   | `PHASE5_CLIENT_DETAIL_BUILD_BRIEF.md` (supersedes CLIENT_DETAIL_BRIEF.md) | Phase 4 ✅ + Phase 3 ✅ — **UNBLOCKED**                                 | backend+mobile      | ✅ ready now                 |
| **6**  | AI Client Summary build (module g: endpoint + `client_ai_summaries` cache + card)                                           | Phase-4 output §g; Bedrock seam #153–156                                  | Phase 4 + Phase 5                                                       | backend+mobile      | after 5                      |
| **7**  | Athlete habit setup screen + coach habit authorship                                                                         | `specs/18-habit-setup/` + `~/Downloads/.../habit-setup.jsx`               | Phase 1 ✅ (authorship uses on-behalf pattern)                          | mobile+backend      | ✅ mostly independent        |
| **8**  | Invite code + QR UI (coach share + athlete redeem)                                                                          | `10-trainer requirements STORY-015` + design § Invite by code             | decision #2; endpoints exist (#136)                                     | mobile              | ✅ independent               |
| ~~9~~  | ~~Programs mobile (F1 coach surfaces + F2 athlete Home)~~ ✅ **MERGED #166**                                                | `specs/19-programs/{requirements,design,tasks}.md` + `coach.jsx`          | backend merged (#148/#149/#152)                                         | mobile              | done                         |
| **10** | Coach Home v1 (triage screen, **no schedule hero**) — replaces ComingSoon stub                                              | `~/Downloads/.../coach-home.jsx` + `10-trainer design § Coach Home`       | decision #1; overview + programs-dashboard endpoints; fix STORY-001 ACs | mobile              | after decision #1            |
| **11** | Attribution badges (athlete side): "Logged by Coach X", "Set by coach"                                                      | `10-trainer STORY-013` + cross-cuts § 1.5                                 | Phase 3 (on-behalf rows to attribute)                                   | mobile              | after 3                      |
| **12** | Notes: endpoints (table exists) + Client Detail notes section                                                               | `10-trainer design § Backend notes` + STORY-011                           | endpoints: Phase 1 ✅; UI: Phase 5                                      | backend then mobile | endpoints ✅ now; UI after 5 |

## Recommended fan-out for parallel sessions

- **Now, independent:** Phase 5 (Client Detail full build — 3 ✅ + 4 ✅, brief ready), Phase 7 (habit setup), Phase 11 (attribution badges — 3 ✅), Phase 12 endpoints (backend) anytime. Phase 8 once decision #2 is confirmed.
- **Gated:** 6 (after 5), 10 (after decision #1), 12-UI (after 5).

## Out of scope (do NOT build)

Appointments/scheduling + add-to-calendar (own future spec). AI import of programs from screenshots/PDF (separate workstream — ROADMAP § 5.3). Trainer-granted client `ai_access` (own spec). Standalone recent-activity endpoint 10.6 (folded into overview). Athlete Fuel / nutrition surfaces beyond the named cross-cuts (EditNutritionTargets sheet, calorie-hit read, attribution).

# 36 — Tasks and acceptance evidence

All pending; discussion scope. Read [requirements](requirements.md) and [design](design.md) before implementation.

- [ ] **W0 Product/contract:** settle coached-client access recommendation, define capability matrix including entry coach tier, agree shared/private content and adherence examples. Trace WS-1,5–8; D2–4.
- [ ] **W1 Model spike:** faithful round-trip of fixed weekdays, irregular weeks, changing set prescriptions, deload and %1RM with absent max; backward-compatible cycle/explicit and populated migration design. Trace WS-3–4; D2. Required before full programme import.
- [ ] **W2 Backend authoring:** owner/self routes and explicit schedule/prescription revisions; guarded client assignment, atomic publish/update, idempotency and old-client response. Trace WS-1–4,8; D2.
- [ ] **W3 Web workspace:** authenticated non-admin route shell, capability-aware navigation, responsive keyboard authoring and import review integration. Trace WS-1–4; D1,D5.
- [ ] **W4 Shared review:** server metric service and scoped safe projection, denominator tests, historical changes/late sync and refresh/version semantics. Trace WS-5,8; D3.
- [ ] **W5 Summary/feedback:** audience-scoped prompts/cache, quota handling, safe shared summary and comment loop; preserve private coach tools. Trace WS-6–8; D4.
- [ ] **W6 Mobile:** role-neutral editor model, self-scheduling and My training/shared client review, capability/stale/offline states; no coach impersonation. Trace WS-1–8; D5.
- [ ] **W7 QA/pilot:** browser/mobile screenshots and accessibility; two-user/two-coach isolation, consent revocation during inference, no-schedule null rate, duplicate and late logs, cancelled/skipped/rest cases, concurrent publish/session start and older binaries. Trace WS-9; D2–5.

Brief: [Workspace and shared review](../milestones/COACHING-WORKSPACE-IMPORT/WORKSPACE_BRIEF.md). Pilot targets are proposed, not evidence. No production database change, paid service activation or native build is part of this scoping session.

# 15 — Exercise AI Classification: Tasks

> Authored 2026-06-03. Implements `requirements.md` + `design.md`. One backend PR + one mobile PR on a shared milestone branch (gate on the e2e smoke), or a single PR if kept small.

---

## Phase 15.1 — Backend classify endpoint (1 PR)

- [ ] **T-15.1.1** Add `groqApiKey = new sst.Secret("GroqApiKey")` to `infra/secrets.ts`; link it to the API in `infra/api.ts`. Document the `sst secret set` step in the PR. Implements STORY-002 AC 2.6, decision #3.
- [ ] **T-15.1.2** Author `groqClassifier.ts`, porting the legacy `classifyExerciseWithGroq` + `mapAIClassificationToDatabase`: `mapClassification(raw, refs)` (pure — category/difficulty → lowercased static-enum; muscle/equipment NAMES → ref-list UUIDs via case-insensitive exact match; drop unmatched + region/movement/accessibility) + `classifyExercise(input, deps)` (fetch ref-list names, build the verbatim legacy prompt, call the injected Groq completion fn with the decision-#1 params, parse, map, 10s timeout, `ClassifyError`). Implements STORY-002 AC 2.2–2.5, decision #5.
- [ ] **T-15.1.3** Author `exercisesClassifyHandler.ts` (`POST /exercises/classify`, `requireAuth`, body validation, reads the muscle/equipment reference lists, returns `{ data }`, 502 on upstream failure). Register it in the core API. Implements STORY-002 AC 2.1, 2.4.
- [ ] **T-15.1.4** Per-user in-memory token-bucket rate limit → 429 when exceeded (the one addition over legacy). Implements STORY-003 AC 3.1–3.3.
- [ ] **T-15.1.5** Unit tests: `mapClassification` (every enum, casing, name→UUID hit/miss, dedupe, partial/empty/non-object, region/movement/accessibility dropped), `classifyExercise` (success, malformed JSON, timeout, non-2xx via injected fake), handler (400/401/502/success, Groq + ref-lists mocked), rate-limit. ≥ 90% coverage; `mapClassification` ~100% branches.

## Phase 15.2 — Mobile wiring (1 PR)

- [ ] **T-15.2.1** Add `classifyExercise` to `domain/ports/api.port.ts` + implement in `sst-api.adapter.ts` + a canned stub in the in-memory api adapter. Types: `ClassifyInput` / `ClassifyResult`.
- [ ] **T-15.2.2** Add a label→coarse map (`MUSCLE_LABEL_DISPLAY_TO_COARSE`) + a `classifyResultToFormPatch(result, resolveLabel)` helper in `exerciseForm.ts` (pure, unit-tested) — resolves UUIDs→labels via the adapter's reference cache, then collapses to the 6 coarse buckets. Implements decision #6.
- [ ] **T-15.2.3** Add the "Tag with AI" action to the Create-Exercise sheet (04.3) + editor (04.6): disabled until name ≥ 2 chars / while tagging / offline; loading state; failure → non-blocking message, form untouched. Implements STORY-001.
- [ ] **T-15.2.4** Container wires `classifyExercise` → maps result → `NewExerciseInput` (sheet: coarse; editor: granular). Online-gate via NetInfo.
- [ ] **T-15.2.5** Tests: adapter request/response mapping; `classifyResultToFormPatch`; button disabled states; success pre-fills form; failure leaves form intact. ≥ 90% coverage.

## Phase 15.3 — Verify

- [ ] **T-15.3.1** `bun run typecheck`, `lint`, `build`, `test:unit` (mobile gate via the node binaries per CLAUDE.md). Backend: `bun run test:unit` for the core service.
- [ ] **T-15.3.2** Manual e2e: type a name → Tag with AI (online) → form pre-fills with valid tags → edit + save → exercise persists. Offline → button disabled. Invalid/garbage name → AI returns sparse/empty, form mostly untouched, no crash.
- [ ] **T-15.3.3** Cost check: confirm `max_tokens`/temperature/rate-limit in place; eyeball Groq dashboard cost after the e2e.

---

## Acceptance gate

- [ ] `POST /exercises/classify` returns only valid V2 enums; never leaks the key; 502s cleanly on Groq failure.
- [ ] The sheet + editor pre-fill from AI and remain fully editable; manual entry unaffected.
- [ ] No DB migrations; no changes to existing exercise CRUD behaviour.
- [ ] CI green; ≥ 90% coverage on changed files.

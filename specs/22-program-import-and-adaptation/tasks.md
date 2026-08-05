# 22 — Program Import & Adaptation: Tasks

**Authored 2026-08-05.** `[B]` backend, `[M]` mobile, `[E]` eval. Eval-gated: **do
not start Phase 1 until Phase 0 clears its bar.** Trace every commit to a
requirements/design section (Kiro discipline).

## Phase 0 — Accuracy + cost eval (GATE, no production code)

- [ ] **T-0.1 [E]** Labelled sample set across all three input types (URL, image,
      PDF) — real programmes, hand-labelled to the extraction schema (design § 1).
- [ ] **T-0.2 [E]** Eval harness: extraction precision/recall per field + a SEPARATE
      exercise-name-resolution accuracy score against the library (AC-0.1). Reuse the
      M9.5 eval playbook.
- [ ] **T-0.3 [E]** Measured per-import cost per input type via `ai-cost-model.ts`;
      vision (image/PDF) is the line to watch (AC-0.2).
- [ ] **T-0.4** Written go/no-go per input type + a quality bar (AC-0.3, checkpoint
      C2). A type below bar ships disabled.
- [ ] **T-0.5** Resolve checkpoint **C1** (AC-3.3 public_url-vs-upload cache reuse
      split) with Brad before Phase 1.

## Phase 1 — URL import (the cheapest, safest input first)

- [ ] **T-1.1 [B]** `extraction_cache` migration + `schema.ts` mirror (design § 4);
      RLS on, no policies. Artifact-type-agnostic.
- [ ] **T-1.2 [B]** Extraction service: forced-tool-use `extract_program` over the
      M9.5 adapter; schema-validate + clamp sets/reps; 422 on malformed (AC-6.1).
- [ ] **T-1.3 [B]** `POST /programs/import/url` — reuse SSRF `url-fetch` → hash →
      cache lookup (public_url scope) → extract on miss → store (AC-3.1/3.3, 6.3).
- [ ] **T-1.4 [B]** Exercise-name resolver: trigram/FTS over the visible catalogue,
      confidence tiers matched/ambiguous/unmatched; NEVER fabricate (design § 2,
      AC-1.3). Per-user, not cached.
- [ ] **T-1.5 [B]** `POST /programs/import/accept` — server re-validates, creates
      spec-19 rows owned by the user, creates custom exercises for unmatched picks
      (AC-1.4). Not a transaction (pooler); recoverable partial write.
- [ ] **T-1.6 [B]** `program_import` entitlement key + **its `assertEntitlement`
      routing line** (premium_plus ∪ trainer tiers) + per-day ceiling (#156)
      (AC-5.1/5.2). ⚠ privacy-policy AI-disclosure update in BOTH copies (the
      mounted-AI-route obligation).
- [ ] **T-1.7 [M]** Import entry (URL) → draft review (editable programme, per-row
      resolution UI: matched/ambiguous-pick/unmatched-create) → accept (AC-1.2/1.3).
- [ ] **T-1.8** Tests: resolver tiers, cache key + reuse-scope both ways
      (public_url shared / upload not), draft→create, two-user isolation, ceiling.

## Phase 2 — Image import (vision)

- [ ] **T-2.1 [B]** `POST /programs/import/upload` (multipart) — vision extraction;
      **per-user** cache scope (upload); EU inference profile only (AC-3.3, design § 1).
- [ ] **T-2.2 [B]** Verify the vision model is granted in BOTH Bedrock accounts.
- [ ] **T-2.3 [M]** Image/screenshot capture + upload into the same draft flow.
- [ ] **T-2.4** Tests + cost re-measure against Phase-0 figures.

## Phase 3 — PDF import

- [ ] **T-3.1 [B]** PDF text/page extraction; scanned-PDF fallback to per-page vision.
- [ ] **T-3.2 [M]** PDF picker into the draft flow.
- [ ] **T-3.3** Tests.

## Phase 4 — Programme-level adaptation (Loadout Phase 4, moved from spec-21)

- [ ] **T-4.1 [B]** Programme-linkage migration + `schema.ts` mirror (spec-21 § 2.4:
      `parent_program_id`, `variation_kind`, `source_gym_id`,
      `source_equipment_type_ids`, partial index, CHECK).
- [ ] **T-4.2 [B]** Programme-level preview as an **async job**: assemble the
      candidate pool **once** over the union of all DISTINCT cycle workouts, run the
      spec-21 remap per distinct workout, cap **10** → **413** beyond, no silent
      truncation (AC-4.2/4.3/4.4). ⚠ Confirm staging Lambda concurrency headroom
      before registering the job kind.
- [ ] **T-4.3 [B]** Create-variant + assign via the existing programme-assignment
      path; `assertTrainerCanActForClient` on every entry point (AC-4.5/4.6).
- [ ] **T-4.4 [M]** Programme detail → adapt-for-location → job progress → review →
      assign.
- [ ] **T-4.5** Tests incl. pool-once dedupe, the cap/413, and an ex-coach (spec-25) 403.

## Cross-cutting (every phase)

- [ ] Draft is ALWAYS editable before create; nothing durable until accept.
- [ ] Model prose bounded + plain-text rendered (AC-6.2); SSRF fetch on every URL.
- [ ] Cache hit writes no `ai_usage_log` row (AC-5.3).
- [ ] `PgDialect`-rendered SQL assertions; revert-verify every fix; two-user isolation.
- [ ] STATE.md + `specs/README.md` index updated as slices land.

## PARKED (not scheduled)

- Cross-user shared/curated library with visibility + verification + IP model
  (design § 9). Its own future spec.
- Recipe-import adoption of `extraction_cache` (spec-16/26 owns the decision).

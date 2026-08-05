# 22 — Program Import & Adaptation: Design

**Authored 2026-08-05.** Architecture for ROADMAP § 5.3 import + Loadout Phase 4
adaptation. Reads on top of spec-19 (Programs), spec-21 (Loadout engine), and the
shipped async-job spine.

## 0. The two pipelines, and where they meet

```
IMPORT (§5.3)                                   ADAPT (Loadout Phase 4)
─────────────                                   ───────────────────────
source (URL | image | PDF)                      a programme (imported OR authored)
  │ fetch/receive → content bytes                 │
  │ HASH → extraction cache lookup ──hit──┐        │ collect equipment (spec-21 scan/manual)
  │ miss → AI extract (forced tool use)   │        │ assemble candidate pool ONCE over the
  │        (vision for image/PDF)         │        │   union of all DISTINCT cycle workouts
  ▼                                       ▼        │ per distinct workout: spec-21 remap engine
extracted STRUCTURE (name, cycle, exercises×{name,sets,reps})   │ cap 10 → 413; async job
  │ RESOLVE each exercise name → library (deterministic, per-user)
  │   matched | ambiguous(pick) | unmatched(create|pick)        ▼
  ▼                                              programme VARIATION (spec-21 § 2.4 linkage)
editable DRAFT ── accept ──▶ spec-19 rows (owned)  ── this is a valid ADAPT input ──┘
```

The seam: **import produces an ordinary spec-19 programme the user owns; adaptation
consumes any spec-19 programme.** They are independent — you can import without
adapting, or adapt a coach-authored programme that was never imported — but chained,
they are the headline "bring your plan in, make it fit your gym" flow.

## 1. Extraction (import stage 1)

Forced-tool-use over the M9.5 Bedrock adapter (`aiBedrockClient.ts`), one schema:

```
extract_program → {
  name: string,
  description?: string,
  daysPerWeek?: int,           // metadata; spec-19 derives week visuals
  cycle: [ {                   // ordered; becomes program_workouts by index
    label: string,             // "Day 1 · Push"
    exercises: [ {
      name: string,            // FREE TEXT — resolved deterministically in stage 2
      sets?: int, reps?: string,   // reps is text: "8-12", "AMRAP", "5x5" handled upstream
      notes?: string
    } ]
  } ]
}
```

The model **never** emits an exercise id, a macro, or anything durable — same
contract as Loadout/Mealprint. It reads an artifact and returns structure; accuracy
and safety are the deterministic layers'.

### Input handling

| Type  | How                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| URL   | Reuse the SSRF-hardened `recipes/services/url-fetch.ts` → fetched bytes → text → text model.                                        |
| Image | Screenshot/photo → **vision** model (Bedrock, EU inference profile only — never `global.`). Heaviest cost line; AC-0.2 measures it. |
| PDF   | Extract text/pages → model. PDFs with scanned images fall back to vision per page. Phase 3 (last).                                  |

⚠ **Bedrock model access is per-account/per-model** — verify the chosen vision model
is granted in BOTH accounts before shipping (Opus 5 is UNGRANTED in prod; a `global.`
profile breaks the DPIA data-residency commitment).

## 2. Exercise-name resolution (import stage 2) — the hard problem

ROADMAP flags "fuzzy exercise-name → exercise-library resolution" as the thing to
eval early. It is deterministic and per-user, not a model call:

1. **Match** — trigram + FTS over the user's visible catalogue, reusing the
   `GET /exercises/search` mechanism (`pg_trgm`, `to_tsvector`; visibility = system ∪
   own customs ∪ connected-PT customs). A single high-confidence hit above a
   similarity threshold → **auto-link**.
2. **Ambiguous** — several near hits, or one below the auto threshold → surfaced in
   the draft as a **short pick-list** (top N), default to the best, user confirms.
3. **Unmatched** — nothing plausible → the draft row offers **create as a custom
   exercise** (the find-else-create the user asked for; reuses the spec-03 create
   path, optionally seeding muscle/equipment from spec-15's AI classify) **or** pick
   manually.

⚠ **Never fabricate a silent match.** `resolveIngredientFood.ts` has a
fabricate-on-miss branch; this must NOT copy it. An auto-link happens only above the
confidence threshold; everything else is the user's explicit choice on an editable
draft (AC-1.3). Thresholds are eval-tuned (AC-0.1), not guessed here.

⚠ **Resolution is per-user and therefore NOT cached cross-user** (AC-3.4) — two users
have different custom catalogues, so the same extracted name resolves differently.
Only stage 1 (extraction) caches.

## 3. Draft → create

Standard draft-confirm: nothing persists until accept. On accept, one create path
writes spec-19 rows the user owns — `workout_programs`, `workouts`,
`program_workouts` (cycle order = extraction order), `workout_exercises` — plus any
newly-created custom exercises (`created_by = user`, private). Reuses spec-19's
create path; **not a transaction** for the same pooler reason as Mealprint's accept
(pgbouncer transaction-mode pins a connection), so create parent-first and make a
partial write recoverable / retryable, or use a single `INSERT ... SELECT` CTE.

## 4. The extraction cache (efficiency) — design § 4

New table, artifact-type-agnostic so recipe import (spec-16/26) can adopt it:

```
extraction_cache (
  content_hash  text PRIMARY KEY,       -- sha256 of the fetched/uploaded bytes
  kind          text NOT NULL,          -- 'program' (future: 'recipe')
  source_class  text NOT NULL,          -- 'public_url' | 'upload'  (drives reuse scope)
  extracted     jsonb NOT NULL,         -- the stage-1 STRUCTURE, pre-resolution
  model_id      text NOT NULL,          -- so a model upgrade can invalidate
  owner_user_id uuid,                   -- NULL for public_url; set for upload (per-user reuse only)
  created_at    timestamptz NOT NULL DEFAULT now()
)
partial UNIQUE (content_hash) — but reuse is gated in the repo by source_class + owner
RLS on, no policies (backend-only, same posture as saved_gyms/nutrition_preferences)
```

**Key on the CONTENT HASH, not the URL.** Two blog URLs serving the same PDF, or a
re-share of the same link, hash identically → extracted once. The fetch is cheap; the
extraction is the ~44×-more-expensive step this exists to dedupe (spec-29 C5 note).

**Reuse scope — the AC-3.3 privacy split, enforced in the repository:**

- `source_class = 'public_url'` → `owner_user_id` NULL, reusable by **anyone** (the
  content was already public).
- `source_class = 'upload'` → `owner_user_id` set, reusable by **that user only** (a
  user's screenshot of a paid programme is never served to another).

Invalidation: `model_id` mismatch on read → treat as a miss and re-extract (a better
model supersedes a stale extraction). No TTL needed — content hash is immutable.

⚠ **A cache hit is not an inference** — it writes no `ai_usage_log` row and consumes
no ceiling/budget (AC-5.3). The user still gets their own owned rows (copy-on-import).

## 5. Adaptation (Loadout Phase 4) — reuses spec-21, orchestrated here

The single-workout **engine is spec-21's and unchanged**: § 6 substitute ranker
(shortlister), § 6.1 equipment containment, § 7 save-path re-verify, § 7.1b intensity
mismatch. This spec adds only the programme-level orchestration.

- **Prerequisite migration (spec-21 § 2.4):** `parent_program_id`, `variation_kind`,
  `source_gym_id`, `source_equipment_type_ids` on `workout_programs`, + the partial
  index + CHECK. This is the T-4.1 migration that moves here as Phase D.
- **Pool once, over distinct cycle workouts.** Assemble the candidate pool a single
  time for the union of all muscles across the programme's **distinct**
  `program_workouts` (dedupe repeats — a cycle repeats), then run the spec-21 remap
  per distinct workout. Linear in distinct workouts.
- **Cap 10 distinct workouts → 413**, no silent truncation (AC-4.3). 10 is comfortable
  headroom over a realistic cycle (a 6-day split is 6); spec-21 § 7.3 carries the
  corrected sizing.
- **Async job** (AC-4.4) — the shared spine (shipped 2026-08-03). ⚠ Register the job
  kind only after confirming staging Lambda reserved-concurrency headroom (the trap
  that broke the spine's first deploy).
- **Result** — a programme variation (spec-21 § 2.4 linkage); each adapted workout a
  workout variation; `position` preserved; base never mutated; assignable via the
  existing path behind `assertTrainerCanActForClient` (AC-4.5/4.6).

## 6. Endpoints (Elysia, `microservices/core`)

All: `requireAuth` → entitlement → ceiling/cache → work; `userId`-first; ownership
checks on every id.

| Endpoint                             | Notes                                                                |
| ------------------------------------ | -------------------------------------------------------------------- |
| `POST /programs/import/url`          | body `{ url }`; SSRF fetch → hash → cache/extract → resolve → draft  |
| `POST /programs/import/upload`       | multipart image/PDF; hash → per-user cache/extract → resolve → draft |
| `POST /programs/import/accept`       | persists a reviewed draft to spec-19 rows (server re-validates)      |
| `POST /programs/:id/loadout/preview` | Phase 4; enqueues the async programme-adaptation job                 |
| `GET /programs/loadout/jobs/:jobId`  | poll job status/result (spine)                                       |
| `POST /programs/:id/loadout/accept`  | persist the programme variation; coach-assign optional               |

Import returns a draft payload (stateless, like Mealprint generate) — the client
edits, then `accept` persists. Adaptation is job-backed because it is not
synchronous.

## 7. Entitlement & cost

- New feature key `program_import` (design § 5). Resolution: premium_plus ∪ all
  trainer tiers, mirroring `loadout_access`. ⚠ **Add its `assertEntitlement` routing
  line** — the catch-all returns `allowed: true` without it (`assertEntitlement.ts`
  documented trap; three keys are already live stubs).
- Adaptation reuses the `loadout` entitlement.
- Per-day import ceiling (#156 fail-safe parse); the number traces to AC-0.2, and its
  interaction with the spec-29 Phase 1 pooled budget is flagged there, not decided
  here.

## 8. Test strategy (≥ 90 %, no fake tests)

- The eval harness (Phase 0) is the accuracy gate; unit tests cover the deterministic
  layers (resolver tiers, cache key/scope, draft→create, the programme-adaptation
  cap + pool-once dedupe).
- ⚠ **Render SQL through `PgDialect`, not "a where clause ran"** — this repo ships
  runtime-only SQL bugs past green mocked suites (`reference_drizzle_groupby_param_bug`).
- ⚠ **Two-user isolation tests** on every read/create/cache path; assert the AC-3.3
  reuse scope both ways (public_url shared, upload not).
- ⚠ **When a test pins a fix, revert the fix and watch it fail.** Reading a test is
  not evidence (the lesson from spec-26's six sweeps).
- Ex-coach-gets-403 on every Phase-4 entry point (spec-25).

## 9. PARKED — cross-user shared/curated library (NOT this spec)

Recorded so it is a deliberate deferral, not an omission. A shared library where one
user's imported programme or composed recipe is discoverable by others needs, at
minimum:

- a **visibility model** (`private`/`friends`/`public`) — we already have the shape
  on `workouts`;
- **provenance + verification status** — an AI-extracted artifact from a blurry photo
  must not become a "canonical" entry others trust, especially where macros/allergens
  are involved (Mealprint's "accuracy is a database property" would be poisoned);
- an **IP/consent boundary** — a coach's paid programme is not ours to pool;
- a **dedup/matching** story for "the same dish/programme" beyond content hash.

The extraction cache here is deliberately **not** that: it is keyed by content hash,
surfaces to no one, attributes to no one, and every user still owns their own copy.
Mealprint-**composed** recipes (macros/allergens from real `foods` rows) are the
safest candidate for a future shared library; photo-**extracted** artifacts the
riskiest — that asymmetry should shape whatever the library spec becomes.

## 10. Decision record

| #   | Decision                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Combined spec: import + Phase 4 adaptation share the athlete/coach entry point and the premium gate.                                                                                              |
| D2  | Loadout Phase 4 **moves here** from spec-21; spec-21 keeps the single-workout engine + § 2.4 columns.                                                                                             |
| D3  | Cache keys on content hash, not URL; reuse scope splits public_url (shared) vs upload (per-user).                                                                                                 |
| D4  | Resolution never cached cross-user; never fabricates a silent match.                                                                                                                              |
| D5  | Cap 10 distinct cycle-workouts (spec-21 § 7.3 corrected); async job; 413 beyond.                                                                                                                  |
| D6  | Shared cross-user library PARKED (§ 9).                                                                                                                                                           |
| C1  | ✅ **RESOLVED (Brad, 2026-08-05) — Option A**: public-URL fetches shared cross-user, uploads per-user only, **no exclusion list** in v1. Detail in § 11.                                          |
| C2  | ✅ **RESOLVED (Brad, 2026-08-05)** — framing accepted (bar = "editing beats retyping", per-failure-mode, auto-match precision strict) + starting thresholds accepted as proposed. Detail in § 11. |

## 11. Checkpoints — RESOLVED (Brad, 2026-08-05)

Both are decisions only Brad could make; both are now answered and the answers are
recorded here so they land against the spec rather than in chat history. Neither
blocked the spec existing; both gated the START of the phase named — now unblocked.

> **✅ C1 — Option A, no exclusion list.** Public-URL fetches (retrieved without
> authentication) may be served cross-user by content hash; photo/PDF **uploads**
> stay keyed per-user and are never served to anyone else. No paywalled-domain
> exclusion list in v1 — the line is "public URL = fetchable without auth". Build
> the `extraction_cache` per § 4 with `reuse_scope` = `public_url` (shared) vs
> `upload` (per-user).
>
> **✅ C2 — framing + starting thresholds accepted as proposed.** The bar is
> "editing the draft beats retyping from scratch", assessed per failure-mode, with
> auto-match precision as the strict axis. Phase-0 ships these thresholds and the
> eval validates against them; move them only if Phase 0 shows cause:
>
> - Structure extraction: **≥ ~85 % per-field accuracy** AND **no systematic
>   whole-workout / whole-exercise drops**.
> - Exercise-name **auto-match precision ≥ ~95 %**; recall unbounded (everything
>   else → ambiguous/unmatched, which cost only a tap).
> - A type that misses its bar ships **disabled**, not degraded.

The original framing for each, kept for the record:

### C1 — Can an AI extraction be reused across users, and for which sources?

**The decision.** Whether `extraction_cache` may serve one user's AI-extracted result
to a **different** user, so the expensive extraction runs once rather than per
importer. **This is a privacy/IP call, not a technical one** — the cache works
identically either way; what differs is whether reuse crosses a user boundary, and
that is a question about other people's material.

| Option              | Behaviour                                                                   | Efficiency                                             | Risk                                                                                                          |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **A (recommended)** | Public-URL fetches shared cross-user; **uploads** (photo/PDF) per-user only | High — popular programmes are usually URLs             | Low — a public URL's content is already public; a private upload never leaves its owner                       |
| B                   | Everything per-user only; no cross-user reuse                               | Low — two users importing the same blog each pay again | Lowest                                                                                                        |
| C                   | Everything shared by content hash, regardless of source                     | Highest                                                | An uploaded screenshot of a **paid/proprietary** programme could be served to a stranger — IP/consent problem |

What Option A means concretely:

- **"Public URL"** = a URL our SSRF-safe fetch retrieves **without authentication**.
  Its content is already on the open web, so caching the derived structure cross-user
  exposes nothing that was not already public.
- An **upload** could be anything — a paid PDF, a friend's plan, a coach's private
  programme. Its extraction stays keyed to that user; a second user re-importing the
  **same file** is deduped, but no one else is ever served it.
- Either way the cache stores the extracted STRUCTURE only, keyed by content hash,
  surfaced to no one, attributed to no one; every user still creates their own owned
  copy, and no user can learn who else imported anything.

**What I need:** pick **A** (or B/C), and say whether any public-URL sources should be
explicitly excluded from cross-user reuse (e.g. known paywalled domains). My
recommendation: **A, with no exclusion list in v1** — "public URL = fetchable without
auth" is a clean, defensible line.

### C2 — What accuracy bar lets each input type ship?

**The decision.** The threshold at which URL / image / PDF import each ship **enabled
vs disabled**, once Phase 0 produces numbers. **You cannot just pick a %** — the right
bar depends on the failure shape and the safety net, so what I need is confirmation of
the FRAMING, then the numbers:

1. **The safety net reframes the bar.** Every import is an **editable draft** before
   anything is created. So the product does not need perfect extraction — it needs to
   be **good enough that editing the draft beats typing the programme from scratch.**
   Below that, import is worse than the manual path it replaces. That, not "% correct",
   is the bar.
2. **Failure modes are not equal, so the bar is per-mode:**
   - A **dropped exercise or whole workout** (silently missing from the draft) is the
     worst — the user cannot fix what they cannot see. Must be **near-zero.**
   - A **wrong sets/reps number** is cheap — visible, one tap to fix. Tolerant.
   - A **wrong SILENT auto-match** on an exercise name (we linked "row" to Barbell Row
     when they meant Seated Cable Row) is bad because it is silent; an **"ambiguous —
     pick one"** is safe because the user chooses. So **auto-match precision must be
     high**, while recall can be traded freely to the ambiguous/unmatched tiers
     (surfacing costs only a tap).

**My proposed starting bars — accept or move them:**

- Structure extraction: **≥ ~85 % per-field accuracy** AND **no systematic
  whole-workout / whole-exercise drops.**
- Exercise-name **auto-match precision ≥ ~95 %** (strict — silent errors); recall
  unbounded (everything else goes to pick/create).
- A type that misses its bar ships **disabled**, not degraded.

**What I need:** confirm the framing (bar = "editing beats retyping"; per-failure-mode;
auto-match precision is the strict one) and whether the starting thresholds are right
or where you would move them. The Phase-0 eval then validates against whatever we set.

# Postgres FTS Investigation — Exercise Search

**Status:** Phase 1 deliverable. Decision pending owner sign-off before any implementation.
**Date:** 2026-05-14
**Author:** Claude (paired with Brad)
**Scope:** Can Postgres FTS (with `pg_trgm`) match the legacy Algolia-powered exercise search on the criteria Brad's staging review flagged?

## TL;DR

**Recommendation: GO, with caveats.** Postgres FTS + `pg_trgm` reaches "feels as good as legacy Algolia" for a curated, ~2.3k-row, single-locale (English) fitness catalogue. The pieces that matter for the failure modes Brad saw on staging — word-order independence, partial-word match, plurals/stemming, multi-field ranking — are handled cleanly by native FTS. Typo tolerance and synonyms (where Algolia genuinely shines OOTB) require `pg_trgm` and a curated aliases column respectively; for our domain (small vocabulary, controlled wording, English-only) both are tractable and not the long tail of edge cases they would be on a general-purpose corpus.

The one place we won't match Algolia OOTB is **arbitrary-prefix typo tolerance with first-class ranking** (e.g. transposition + missing-char in the same query, ranked under a unified score). For our use case, the trigram-only hybrid is good enough.

**Estimated implementation effort:** 1–1.5 days backend + mobile + tests + smoke. See "Effort breakdown" at bottom.

---

## What we're replacing

Two layers both have the same substring bug:

- **Backend** — `microservices/core/src/application/repositories/exerciseRepository.ts:283-298` runs `ILIKE '%term%'` across `name + description + instructions`. Word-order dependent, no stemming, no fuzziness.
- **Mobile** — `packages/mobile/src/domain/services/exercise.service.ts:29-38` scores exercises by `.includes()` against the trimmed lowercase term. Same defects, applied locally on the SQLite cache.

Brad's staging repro: searching `"press bench"` against `"Bench Press"` returns nothing. Confirmed in both layers.

Legacy reference: `persistence-mobile/hooks/api/useGetExercises.ts:74` called Supabase edge function `get-exercises-search` which proxied to an Algolia index. The edge-function source isn't committed in the legacy repo (deployed-only). We don't know the exact Algolia config — typo tolerance threshold, searchable attributes weighting, synonyms list — but Algolia defaults give us a fair baseline.

---

## Method

Postgres FTS (`tsvector` / `tsquery`) and `pg_trgm` behaviours are deterministic and documented. The 6 criteria below are evaluated by reading published Postgres semantics and writing worked SQL against the live `exercises` schema. Spot-checks should be run against the staging Supabase DB (or a Neon branch) before phase 2 ships — but the architectural answer doesn't need a live DB to land; we know what these operators do.

Where a claim is documentation-grounded I mark it `[docs]`. Where it depends on the actual corpus distribution (and therefore needs a smoke before relying on it), I mark it `[verify]`.

Schema reminder — `exercises` has `name TEXT NOT NULL`, `description TEXT`, `instructions TEXT`. Approximate row count: ~2.3k system exercises plus user customs.

---

## Criterion-by-criterion evaluation

### 1. Word-order independence — `"press bench"` → `"Bench Press"`

**Algolia:** ✅ Yes, native. Algolia tokenises both query and document and AND-matches independent of position by default.

**Postgres FTS:** ✅ Yes, native. `to_tsvector('english', 'Bench Press')` produces `'bench':1 'press':2`. `plainto_tsquery('english', 'press bench')` produces `'press' & 'bench'`. The `@@` match operator AND-matches lexemes regardless of position. `[docs]`

Worked query:

```sql
SELECT name
FROM exercises
WHERE to_tsvector('english', name) @@ plainto_tsquery('english', 'press bench');
-- → 'Bench Press' matches
```

Verdict: **clean win**. Identical behaviour to Algolia.

---

### 2. Partial-word match — `"benc"` → `"Bench Press"`

**Algolia:** ✅ Yes — Algolia indexes prefix tries; partial-prefix matching is a default.

**Postgres FTS native:** ❌ No, not OOTB. `plainto_tsquery` produces a full-token lexeme `'benc'`, which does not match `'bench'` because the lexeme set on the document side doesn't contain `'benc'`.

**Two solvable paths:**

**(a) `websearch_to_tsquery` + manual `:*` prefix suffix.** Append `:*` to each term:

```sql
SELECT name
FROM exercises
WHERE to_tsvector('english', name) @@ to_tsquery('english', 'benc:*');
-- → 'Bench Press' matches (prefix lexeme)
```

This is the cleanest native solution. A small helper in the repository transforms a free-text query into a prefix-token tsquery string by lexing on whitespace, escaping reserved chars (`& | ! ( ) : * <-> '`), and appending `:*` to each:

```ts
function toPrefixTsQuery(q: string): string {
  return q
    .replace(/[&|!():*<>'"\\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}:*`)
    .join(" & ");
}
// "press bench" → "press:* & bench:*"
```

**(b) `pg_trgm` similarity.** `similarity('benc', 'bench')` ≈ 0.36; `similarity('benc', 'bench press')` ≈ 0.20. Useful for fuzzy match (criterion 3) but a worse fit for _clean_ prefix-of-a-real-word matching because the score conflates "partial real word" with "typo near the start" and is sensitive to length.

**Recommendation:** Use **(a)** as the primary mechanism for partial matches and let trigram handle typo cases (criterion 3).

Verdict: **win with a small tokenizer helper.** Match parity with Algolia once `:*` suffixing is wired up.

---

### 3. Typo tolerance — `"bnech press"` (transposition), `"bench pres"` (missing char), `"bencj press"` (adjacent-key)

**Algolia:** ✅ Yes — typo distance is a first-class default with sane thresholds.

**Postgres FTS native:** ❌ No. Lexemes do not fuzzy-match.

**`pg_trgm`:** ✅ Yes, this is exactly what it solves. Two operators matter:

- `%` — boolean match against the per-session `similarity_threshold` GUC (default 0.3, tunable per session via `SET pg_trgm.similarity_threshold`)
- `similarity(a, b)` — returns a [0..1] score for ranking

`[verify]` Estimated similarity scores for our three failure modes (transposition / missing-char / adjacent-key), based on trigram overlap math:

- `similarity('bnech', 'bench')` ≈ 0.42 — above default 0.3 threshold ✅
- `similarity('pres', 'press')` ≈ 0.50 ✅
- `similarity('bencj', 'bench')` ≈ 0.50 ✅

But: trigram works on substrings, not lexemes. To match against the _exercise name_, not against an individual term, we use the `%` operator on a concatenated name+description column or use `word_similarity` / `strict_word_similarity` which are designed for matching a query phrase against a longer string:

```sql
SELECT name, word_similarity('bnech press', name) AS sim
FROM exercises
WHERE name %> 'bnech press'   -- word_similarity above threshold
ORDER BY sim DESC
LIMIT 20;
-- → 'Bench Press' ranks at the top
```

**Where Algolia genuinely beats Postgres:** ranking quality on typos. Algolia weighs typo distance into a unified ranking model; with pg*trgm we get a similarity score that we manually blend with FTS rank (see § Ranking strategy). For a curated, English-only, 2.3k-row catalogue, the blended ranking is \_good enough* — the queries that fail under pg_trgm are exotic enough (>2 char errors, transpositions and missing chars together, etc.) that they're below the bar of "feels as good as Algolia in everyday use".

Indexing: `CREATE INDEX exercises_name_trgm_idx ON exercises USING gin (name gin_trgm_ops);` — `%>` and `<%` can use it. `[docs]`

Verdict: **good-enough win, not parity.** Acceptable for the use case; flag in the report if Brad wants to validate against a list of failure phrases.

---

### 4. Multi-field ranking — name match should outweigh description match

**Algolia:** ✅ Yes, via `searchableAttributes` priority order.

**Postgres FTS:** ✅ Yes, via `setweight()` on the `tsvector`. Standard pattern: generate a single combined `tsvector` per row that weights each source:

```sql
ALTER TABLE exercises ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(instructions, '')), 'C')
  ) STORED;

CREATE INDEX exercises_search_idx ON exercises USING gin (search_vector);
```

`ts_rank(search_vector, query)` then applies higher weights to A-class lexemes by default (`{0.1, 0.2, 0.4, 1.0}` for D, C, B, A respectively — tunable via `ts_rank(weights, vec, q)`). `[docs]`

Verdict: **clean win.** Generated stored columns + GIN index is a well-trodden pattern.

---

### 5. Synonyms — `"lat pulldown"` ↔ `"pulldown"` ↔ `"pull down"`

**Algolia:** ✅ Yes, synonym dictionaries are UI-configurable per index.

**Postgres FTS:**

- **Native synonym dict:** Postgres supports synonym dictionaries (`CREATE TEXT SEARCH DICTIONARY ... TEMPLATE = synonym`), but the dictionary is a **server-side file** loaded from `$SHAREDIR/tsearch_data/`. On Supabase managed Postgres, this is **not user-writable** — you cannot upload custom dict files. ❌
- **Thesaurus dict:** Same problem — file-driven.
- **Pragmatic alternative:** Add an `aliases TEXT[]` (or `search_aliases TEXT`) column to `exercises`, include it in the generated `search_vector` at weight B or A, and curate a small list per row at ingest time. For our domain the synonym space is _small and well-known_ (lat pulldown / pulldown / pull down; squat / back squat; etc.). 50–100 rows in the catalogue probably need an alias entry.

Worked schema:

```sql
ALTER TABLE exercises ADD COLUMN search_aliases TEXT;  -- e.g. "lat pulldown, pull down"
-- regenerate search_vector to include it at weight A
```

Verdict: **clunkier than Algolia, but tractable.** Curation cost is real but bounded.

---

### 6. Plurals / stemming — `"deadlifts"` → `"deadlift"`, `"squats"` → `"squat"`

**Algolia:** ✅ Yes via `removeStopWords` + per-language stemmer.

**Postgres FTS:** ✅ Yes — the `english` text search configuration ships a Snowball stemmer that handles regular plurals, common verb forms, and English stop words. `to_tsvector('english', 'deadlifts')` produces `'deadlift':1`. `[docs]`

Verdict: **clean win.** Identical behaviour for English.

---

## Side-by-side summary

| Criterion                          | Algolia (legacy)   | Postgres FTS + pg_trgm         | Verdict                 |
| ---------------------------------- | ------------------ | ------------------------------ | ----------------------- |
| 1. Word-order independence         | ✅ native          | ✅ native                      | parity                  |
| 2. Partial-word (`benc` → `bench`) | ✅ native          | ✅ via `:*` prefix suffix      | parity                  |
| 3. Typo tolerance                  | ✅ first-class     | ⚠️ `pg_trgm` + ranking blend   | good-enough, not parity |
| 4. Multi-field ranking             | ✅ native          | ✅ `setweight()`               | parity                  |
| 5. Synonyms                        | ✅ UI-configurable | ⚠️ curated `aliases` column    | clunkier, bounded       |
| 6. Plurals / stemming              | ✅ native          | ✅ `english` config (Snowball) | parity                  |

---

## Ranking strategy

A single ORDER BY blends the FTS rank with a trigram tie-breaker. The goal is: when the query matches lexemes cleanly (criteria 1, 2, 4, 6), FTS rank dominates; when it doesn't (criterion 3 — typos), trigram similarity carries the result above the threshold.

```sql
WITH q AS (
  SELECT
    to_tsquery('english', $1::text) AS tsq,   -- e.g. 'press:* & bench:*'
    $2::text AS raw                            -- 'press bench' or 'bnech press'
)
SELECT
  e.id, e.name,
  ts_rank(e.search_vector, q.tsq) AS ts_score,
  word_similarity(q.raw, e.name) AS trgm_score,
  (ts_rank(e.search_vector, q.tsq) * 2)
    + word_similarity(q.raw, e.name) AS combined
FROM exercises e, q
WHERE
  -- visibility predicate (same as today)
  ( ... )
  AND (
    e.search_vector @@ q.tsq
    OR e.name %> q.raw       -- pg_trgm fallback when FTS misses
  )
ORDER BY combined DESC, e.name ASC
LIMIT 20 OFFSET $3;
```

Weights (`* 2` on ts_score) are a starting point — tune against a labelled "what should come first" list during phase 2.

---

## What we'd actually build (phase 2 sketch)

**Migration** (idempotent, Drizzle SQL template for `tsvector` operators):

- `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- `ALTER TABLE exercises ADD COLUMN search_vector tsvector GENERATED ALWAYS AS ( ... ) STORED;`
- `ALTER TABLE exercises ADD COLUMN search_aliases TEXT;` _(optional in phase 2.0 — add when curating begins)_
- `CREATE INDEX exercises_search_idx ON exercises USING gin (search_vector);`
- `CREATE INDEX exercises_name_trgm_idx ON exercises USING gin (name gin_trgm_ops);`

Forward + revert tested before merge.

**Backend** — new endpoint `GET /exercises/search?q=...`:

- Reuses the same visibility predicate the list endpoint uses (`buildVisibilityCondition` in `exerciseRepository.ts:150`).
- Query helper: `toPrefixTsQuery` — escapes reserved chars, splits on whitespace, appends `:*` to each token, AND-joins.
- Empty `q` (or length < 2): returns 400. The mobile container won't call it under 2 chars.
- Pagination: same limit cap (`MAX_LIMIT = 3000`) and default (20) as the list endpoint. Likely lower default — 50 feels right for a search response, but match the list default for consistency.
- The existing `GET /exercises` `q=` filter (ilike) stays intact — `/exercises/search` is the new path. The list endpoint's `q=` could later be retired in favour of routing through `/search` internally, but that's a follow-up.

**Mobile**:

- `searchExercises(q)` method on the API port (`packages/mobile/src/application/ports/api.port.ts` — confirm name when implementing) + adapter (`sst-api.adapter.ts`).
- `ExerciseListContainer` — when `q.length >= 2` AND online, call the server endpoint and use those results (replacing the local `filterExercises` for the search-text axis only; muscle/equipment/etc. filters stay server-driven via the existing list endpoint or apply client-side over the search result page).
- `AddExercisePopover` / `SwapExercisePopover` / `AddExerciseToSupersetPopover` — same pattern. Brief explicitly calls these out as having the same `.includes()` bug; they should share the new search path.
- **Offline fallback** — keep `filterExercises` for cache-only queries when offline, but add **tokenisation** so out-of-order works offline too:
  - Lowercase, split on whitespace, AND-match all tokens against `name + description + (aliases?)`.
  - No typo tolerance offline (acceptable trade-off; the docs say offline is "fewer-feature mode").
- Reuse the existing 300ms `useDebouncedValue` (`ExerciseListContainer.tsx:36`).

**Tests** (the 90% threshold rules):

- Backend unit (repo): word-order, partial, typo, ranking, userId-scoped customs, empty-q rejection.
- Backend integration / handler: auth, pagination caps, 400 on `q.length < 2`, ts_rank ordering on a fixture.
- Mobile unit: API port + adapter, container debounce + online/offline branch, local `filterExercises` tokenisation.
- Smoke: against a Neon branch DB (Brad's preferred validation path) with a snapshot of the real exercise corpus.

---

## Risks / caveats

1. **Generated columns on Supabase Postgres.** Generated stored columns are supported on PG12+. The Supabase DB version should be confirmed before the migration. `[verify]`
2. **Index build time + size.** Two GIN indices on a 2.3k-row table is trivial. At 10× growth still fine.
3. **`pg_trgm` extension.** Supabase ships with `pg_trgm` available via `CREATE EXTENSION` — Supabase docs confirm. `[verify]` against the actual project's installed-extensions list before shipping.
4. **Live Supabase reads while migration runs.** Generated-column ALTER is one-time-scan; on 2.3k rows it's milliseconds. Safe.
5. **`websearch_to_tsquery` vs `to_tsquery`.** `websearch_to_tsquery` is friendlier (handles quotes, `OR`, `-` operator) but does NOT support `:*` prefix in user input. We use `to_tsquery` with our own tokenizer for that reason. Trade-off: we own the input sanitisation — escaping reserved chars matters or callers can crash the parser.
6. **Synonyms cost.** We're committing to curating an aliases column over time. Cheap on day one (probably 0 entries), grows with reports of "I searched X and didn't get Y". Probably 50–100 entries total.
7. **Ranking blend coefficient.** Starting with `ts_rank * 2 + word_similarity` — needs tuning. Worth a small labelled set of "queries we want to work" in tests so regressions are caught.
8. **Brad's quality bar is subjective.** "Feels as good as legacy Algolia" is the test. I'd want a 10-query test list (the ones Brad noticed failing + a few he'd expect to work) and a side-by-side staging comparison before claiming parity.

---

## Effort breakdown (phase 2, conditional)

| Slice                                                                              | Estimate    |
| ---------------------------------------------------------------------------------- | ----------- |
| Migration + extension + indexes + Drizzle plumbing                                 | 0.25 d      |
| Backend repo `search()` + helper tokenizer + handler + tests                       | 0.5 d       |
| Mobile API port + adapter + container wiring + local fallback tokenisation + tests | 0.5 d       |
| Picker popovers (AddExercise / Swap / AddExerciseToSuperset) — same plumbing       | 0.25 d      |
| Smoke + ranking-tune against real corpus                                           | 0.25 d      |
| **Total**                                                                          | **~1.75 d** |

Reasonable buffer for Inspector Brad follow-ups: add another 0.25 d.

---

## Recommendation

**Go**, with the caveats:

- Typo-tolerance ranking won't be quite Algolia-grade in pathological cases. For our corpus this is fine.
- Synonyms become a small curation chore via `search_aliases` column. Cheap to start; add entries as users surface gaps.
- The `:*` prefix tokenizer must escape reserved chars or `to_tsquery` will throw on a stray `&` / `:`.

If the recommendation is accepted, phase 2 ships behind a single PR `feat: exercise search via Postgres FTS` per the brief, with a 10-query labelled set in tests so ranking regressions get caught.

If the recommendation is rejected, the decision tree reopens — options are (a) port the legacy Algolia path back (ruled out per brief), (b) build a different fuzzy index (e.g. ParadeDB / Meilisearch — new infra, large lift), or (c) accept the current substring search and revisit later.

## Open questions for Brad before phase 2

1. Confirm Supabase PG version supports generated stored columns + `pg_trgm` extension is enabled on the project. (Both are near-certain; a quick `SELECT * FROM pg_extension` and `SHOW server_version` against staging settles it.)
2. Do you want a labelled "must work" query list as part of tests, or trust the smoke-on-staging eyeball? My preference: a 10-query list, very cheap.
3. Should `GET /exercises?q=` (the existing ilike path) be retired and proxy to the new search, or kept as a parallel surface for back-compat? My preference: keep both; route them differently; revisit after a release.

# M9 — Nutrition Data Sourcing (barcode · food DB · AI recognition)

> Researched 2026-06-21 (extended 2026-06-21 with bulk-replication feasibility + an AI-recognition industry survey, in response to Brad's follow-up). This is the data-layer architecture the BACKEND_BRIEF + FRONTEND_BRIEF assume. **Read before locking the barcode-resolve endpoint or scoping M9.5.**

## TL;DR

| Concern                             | Answer                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Barcode **decode**                  | `expo-camera` on-device — **free, no key, offline** (EAN-13 / UPC-A). Only the _lookup_ is networked.                                                                                                                                                                                                  |
| Food **database** (M9 Tier A)       | **Open Food Facts (OFF)** — free, no key, global branded coverage. ODbL (attribution required). **15 req/min/IP** for live reads.                                                                                                                                                                      |
| **Bulk-replicate OFF into our DB?** | **Yes, viable and legally OK** (see § 5). Serving lookups to users is a "Produced Work" → **no share-alike on our app/user data**; attribution required + offer the OFF-derived subset under ODbL on request. **Recommended: seed a _curated subset_ (not the full 43 GB), refresh via daily deltas.** |
| Offline food lookup                 | Bulk seed + on-device `cached_foods` makes offline barcode useful from day 1 (cache-first alone only covers previously-scanned items).                                                                                                                                                                 |
| **AI image recognition** (M9.5)     | Industry leaders (MyFitnessPal/Lose It/MacroFactor) = **recognition by CV + macros from a verified DB + user-editable portions** — NOT pure vision→calories. This is exactly the "limited AI" shape Brad wants. See § 6 for the layered workflow + vendor options.                                     |

---

## 1. Barcode scanning — solved, free, on-device

`expo-camera`'s `CameraView` + `onBarcodeScanned` decodes EAN-13 / UPC-A **on-device** (Android via Google Code Scanner / Play Services, no bundled ML model, no key; iOS native). Decode works offline; only the _lookup_ (§ 2) is networked. `expo-barcode-scanner` is deprecated — `expo-camera` is the SDK 52+ path.

## 2. Open Food Facts — free, but live reads are rate-limited per IP

- **Free, no API key for reads.** Writes need an account (we don't write).
- **15 product reads/min/IP; 10 search/min/IP.** Exceed → OFF may IP-ban.
- **Mandatory custom User-Agent**: `Persistence/<ver> (<contact-email>)`.
- **ODbL licence** — attribution required (see § 5 for the full verdict).
- The catch: proxying live reads through one Lambda concentrates all users' scans on one IP. Mitigations (live-read path): cache-first via our `foods` table, 429 backoff, circuit-breaker. **§ 5's bulk seed removes the live-read dependency for common products entirely** — the better long-term answer.

## 3. Other databases (use more than one source — Brad's steer)

| Source                           | Licence                                        | Best for                                                                 | Notes                                                                                          |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Open Food Facts**              | ODbL (attrib + share-alike-on-derivative)      | Global **branded/barcoded** packaged food                                | Free, no key. Our M9 primary.                                                                  |
| **USDA FoodData Central**        | **Public domain** (no attribution/share-alike) | **Generic/whole foods** ("chicken breast", "banana") + the text/NLP path | Free API key. No ODbL headache — cleanest source. Weak on branded barcodes. Strong complement. |
| Nutritionix                      | Proprietary, paid                              | Branded + restaurant + **natural-language parsing**                      | 1M+ foods, RD-verified, 250M queries/mo. Paid; key = SST Secret.                               |
| FatSecret / Edamam / Spoonacular | Proprietary, paid                              | Branded + recipes                                                        | Revisit only if OFF+USDA coverage proves thin.                                                 |

**Recommendation:** OFF for barcodes + **USDA FDC for generic-food search** (public domain → no licensing friction, and it's the natural backing DB for the free-text/NLP path in § 6). Both free.

## 4. Data flow (M9 Tier A, live-read variant)

```
[scan]  expo-camera on-device decode (free, offline)
   │ EAN/UPC
   ▼ POST /nutrition/barcode/resolve
   │ 1. SELECT foods WHERE barcode = ?         ← warm cache / bulk seed, no OFF hit
   │ 2. miss → OFF GET /api/v2/product/<code>  (UA set, 8s timeout, 429 backoff)
   │ 3. OFF hit → INSERT foods(source='openfoodfacts') → return
   │    OFF miss → 404 → user adds manually (source='user')
   ▼ device caches resolved Food in cached_foods
```

---

## 5. Can we bulk-scrape OFF and replicate it in our DB? — Yes (with care)

**Brad's question. Short answer: yes, and it's the right de-risking move — but seed a _curated subset_, not the whole thing, and mind the ODbL obligation.**

### What OFF actually offers (no scraping needed — they publish dumps)

Don't scrape the API (that's what the rate limit is for). OFF publishes the whole DB for bulk reuse:

| Format                                 | Size                      | Use                                                                  |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| **Parquet** (simplified)               | ~few GB                   | **Best for us** — columnar, filter/query with DuckDB before loading. |
| JSONL (NDJSON)                         | ~7 GB gz / **~43 GB** raw | Full fidelity; too big to load naively into Neon.                    |
| CSV                                    | ~0.9 GB gz / ~9 GB raw    | Tabular subset via advanced-search export.                           |
| MongoDB dump                           | large                     | Native Mongo restore.                                                |
| **Daily delta exports** (last 14 days) | small                     | **Incremental freshness** — apply deltas on a schedule.              |

### The licence verdict (ODbL — the real gating concern)

ODbL splits obligations between a **Derivative Database** (our stored copy/extension of OFF) and a **Produced Work** (the nutrition facts we show a user):

- **Serving lookups to users via our app/API is a _Produced Work_, NOT "conveying" the database** — ODbL explicitly excludes "interaction with a user through a computer network … where no transfer of a copy of the Database … occurs." **So share-alike does NOT force us to open-source our app or our user data.** Produced Works need **attribution only**; we can put our own terms on them.
- The OFF-derived table itself _is_ a Derivative Database. Obligation: **attribute OFF**, and **on request, offer the OFF-derived portion under ODbL** (or the means to recreate it). That's it — and it only covers the OFF-sourced rows, not our user/proprietary data.
- **Practical guardrails:** tag OFF rows (`source='openfoodfacts'`) so the derivative DB we'd offer on request is cleanly separable from user-created/other-source rows; show an OFF credit on food detail + an About/Data-sources line; **don't** bulk-redistribute the DB publicly. This is the same posture OpenStreetMap's huge commercial ecosystem runs on.
- ⚠️ **Not legal advice** — the "combine with other DBs → resulting DB must be open" reading is conservative, and the "offer derivative on request" duty is real. Worth a quick legal sanity-check before shipping a bulk replica. FatSecret/Nutritionix are proprietary precisely to sidestep ODbL; USDA (§ 3) is public-domain and carries none of this.

### Recommended approach (decision for Brad)

**Don't load all 43 GB.** Three options, in increasing effort:

1. **Cache-first only (current briefs).** Zero upfront infra; OFF traffic decays as the cache warms. Downside: cold cache early-on flirts with the rate limit, and offline barcode only covers previously-scanned items.
2. **Curated seed + cache-first (RECOMMENDED).** Use DuckDB to filter the Parquet dump to high-value rows (complete macros + target locales, e.g. UK/EN + maybe top-popularity), load that subset into `foods` (tagged `source='openfoodfacts'`), keep lazy cache-first for the long tail, refresh via daily deltas. **Removes the rate-limit risk + makes offline barcode genuinely useful from day 1**, at a manageable Neon footprint.
3. **Full mirror.** Load everything, run a local Product Opener / delta sync. Heaviest infra + storage + the strongest ODbL footprint. Overkill until scan volume justifies it.

**DECIDED 2026-06-21 — option 2, in M9.** Brad confirmed the curated seed ships in M9. It's a dedicated backend task (seed/ETL script + delta-refresh cron, BACKEND_BRIEF § 9) in its own PR — kept out of the resolve-endpoint PR so it doesn't bloat it. Option 3 (full mirror) stays the future lever if volume ever justifies it.

---

## 6. AI food recognition — industry survey + the "limited AI" workflow

**Brad's steer: limit AI, lean on other sources. The research strongly backs that instinct — it's also what the best apps actually do.**

### How the leaders do it

| App                          | Approach                                                                                                                                       | Accuracy signal                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **MyFitnessPal** (Meal Scan) | **Passio** on-device CV → matches their **14M verified DB**                                                                                    | ~71% food ID; ±18% portion error               |
| **MacroFactor**              | CV detects **branded products → searches product DB**; breaks meal into **editable, inspectable** entries; recommends barcode for single items | DB-backed, fully inspectable                   |
| **Lose It!** (Snap It)       | AI photo recognition + **1.8M verified DB**                                                                                                    | <3s, editable portions                         |
| **Cal AI**                   | **Pure vision → estimate contents** (DB-light)                                                                                                 | Faster but less accurate; the pattern to avoid |

**The throughline:** the accurate apps use **CV/AI only for the fuzzy "what is this?" step, then pull authoritative macros from a verified DB, and make portions user-editable.** Pure "photo → calories" regression (Cal AI) compounds errors — recognition × portion × conversion, each with its own ceiling (a 2025 RCT found ~68% end-to-end; portion estimation as low as ~39% reliable). **Never write raw model macro numbers as truth.**

### The layered workflow we should build (cheapest/most-deterministic first)

```
1. Barcode            deterministic, on-device decode + DB lookup     ~100% when found   ← M9
2. Text search        query verified DB (OFF + USDA)                  deterministic      ← M9
3. Free-text NLP      "2 eggs and toast" → parse → resolve to DB rows limited AI         ← M9.5
4. On-device image    on-device classifier → candidate foods → DB     limited AI, no cloud cost ← M9.5
5. Cloud vision       multimodal LLM → items → resolve to DB          most $/least determ.  ← M9.5 fallback only
```

AI escalates only when the cheaper layer can't answer. Layers 3–5 all **resolve names against a verified DB for the actual macros + present editable portions** — AI never owns the numbers.

### Vendor options for layers 3–5 (M9.5 decision, not M9)

- **Free-text NLP (layer 3):** Nutritionix Natural-Language API (NLP, RD-verified DB, the classic for "2 eggs and toast") — paid. OR a cheap LLM constrained to emit structured items, resolved against our DB. Lowest-AI, high-value, do this first in M9.5.
- **On-device image (layer 4):** **Passio Nutrition-AI SDK** — on-device recognition, **no per-photo cloud cost**, privacy, offline. Token-based pricing (~20–30k tokens/photo, $2.50/M overage; plans $25→$300/mo by user count). Powers MyFitnessPal. This is the strongest "limited AI" image path.
- **Cloud image APIs (layer 5):** LogMeal (credit/image, 30-day trial), Foodvisor Vision API (enterprise/contact-sales) — specialized food CV. OR a general multimodal LLM (GPT-4o / Gemini / Groq llama-vision — repo already has a Groq fetch pattern from spec 15) constrained to return item names + rough portions only.

### Recommendation for the M9.5 brief

- Build **layer 3 (free-text NLP) first** — highest value, lowest AI, leans entirely on the verified DB.
- For images, prefer **on-device (Passio) or a constrained cloud-vision call that returns names only** → resolve macros from OFF/USDA/our `foods` → user edits portions. **Reject the pure vision→calories pattern.**
- Keep `aiAccess` gating + `ai_usage_log` (stub ships in M9) so we measure real per-user AI cost before committing to a paid vendor.
- `ai_usage_log` data + the layered fallback together keep AI spend bounded and accuracy honest.

---

## Sources

**OFF data + licence:** [OFF Data/API/SDKs](https://world.openfoodfacts.org/data) · [openfoodfacts-exports](https://github.com/openfoodfacts/openfoodfacts-exports) · [DuckDB × OFF (OFF blog)](https://blog.openfoodfacts.org/en/news/food-transparency-in-the-palm-of-your-hand-explore-the-largest-open-food-database-using-duckdb-%F0%9F%A6%86x%F0%9F%8D%8A) · [OFF API rate limits](https://openfoodfacts.github.io/openfoodfacts-server/api/) · [OFF terms of use](https://world.openfoodfacts.org/terms-of-use) · [ODbL (Open Data Commons)](https://opendatacommons.org/licenses/odbl/) · [ODbL summary](https://opendatacommons.org/licenses/odbl/summary/) · [OSM legal FAQ (Produced Work vs Derivative)](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)
**Barcode:** [expo-camera SDK](https://docs.expo.dev/versions/latest/sdk/camera/) · [expo-barcode-scanner deprecation](https://github.com/expo/expo/issues/27015)
**AI recognition:** [MyFitnessPal × Passio (BrainStation)](https://brainstation.io/magazine/myfitnesspal-introduces-ai-photo-recognition) · [MyFitnessPal Meal Scan benchmark 71.2%](https://ai-food-tracker.com/reviews/myfitnesspal/) · [MacroFactor AI food logging](https://macrofactor.com/ai-food-logging/) · [Passio cost breakdown](https://www.passio.ai/cost-breakdown) · [LogMeal API pricing](https://logmeal.com/api/pricing/) · [Nutritionix Natural-Language API](https://www.nutritionix.com/natural-demo) · [AI calorie photo accuracy 2026 (Fitia)](https://fitia.app/learn/article/ai-calorie-photo-apps-accuracy-2026/) · [USDA FoodData Central](https://fdc.nal.usda.gov/)

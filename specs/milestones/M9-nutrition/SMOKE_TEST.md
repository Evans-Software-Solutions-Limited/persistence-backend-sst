# M9 — Nutrition (Fuel) · Tier A — Smoke Test

Reviewer's end-to-end walkthrough. Each step maps to a `13-nutrition-tracking/requirements.md` acceptance criterion. Run against `bun run dev` (backend on staging Neon) **and an EAS dev build on a physical device** (barcode + camera steps cannot run in Expo Go — see BRIEF § New dependencies + EAS impact).

## Pre-conditions

- [ ] Backend branch `feat/m9-backend-nutrition` merged (or running locally); migration applied to the test DB; `notification_type` enum includes `daily_nutrition_target_hit` (`SELECT enum_range(NULL::notification_type);`).
- [ ] Mobile branch `feat/m9-mobile-nutrition` built as an EAS dev client; new deps (`expo-camera`, `@shopify/flash-list`, `expo-image`, `expo-haptics`) bundled; camera permission granted on first prompt.
- [ ] Test athlete user signed in (regular role, not coach — the Fuel tab is hidden in coach mode per `14-navigation` AC 6.3).
- [ ] A second device/account with a real barcode product to scan (or a printed EAN-13 of a product known to Open Food Facts, e.g. a common cereal).

## A. Fuel screen renders (STORY-001)

1. [ ] Open the Fuel tab → the real screen renders, **not** `<ComingSoon/>`. (AC 1.1)
2. [ ] Header shows large "Fuel" title + eyebrow `<DAY> · <MON DD>` + Target & Calendar IconBtns. (AC 1.2)
3. [ ] MacroHero shows a **single gold `<Ring>`** with REMAINING kcal centred (mono font) + 3 macro lines (Protein/Carbs/Fat) as bars with `value/target`. (AC 1.3, decision #3 — confirm it is NOT a MultiRing)
4. [ ] Consumed · Target stat row at the bottom of the hero, with an EDIT button. (AC 1.4)
5. [ ] QuickAddRow shows **4** buttons: Scan / Snap / Search / Recipes (Conflict C5). Snap shows a **lock** icon. (AC 1.5)
6. [ ] MealLog shows 4 sections (Breakfast/Lunch/Snack/Dinner), each with a kcal sub-total + Add button + empty state. (AC 1.6)
7. [ ] WaterTracker shows cups vs goal (default 8). (AC 1.7)

## B. Barcode log (STORY-002) — dev build, on device

8. [ ] Tap Scan → bottom sheet opens at ~78% with a live camera view + animated scanning line. (AC 2.1, 2.2)
9. [ ] Point at the product barcode → within ~1s it resolves (`POST /nutrition/barcode/resolve`) → food card shows name + brand + macros + serving selector + meal selector. (AC 2.3, 2.4)
10. [ ] Pick "Breakfast", set serving, tap Add → `POST /nutrition/entries` → sheet closes → entry appears under Breakfast → MacroHero ring + Consumed recalc. (AC 2.5, 2.6)
11. [ ] Reopen Scan → close it → confirm the camera releases (no battery-warning / hot device after repeated open/close). (Perf budget)

## C. Quick Add log (STORY-003)

12. [ ] Tap Add on the Lunch header → `<QuickAddSheet>` opens. (AC 3.1)
13. [ ] Type a food name → results list (recents + foods + recipes + meals) → tap one. (AC 3.2)
14. [ ] Set serving; meal slot defaults to Lunch → Add → `POST /nutrition/entries` → appears under Lunch. (AC 3.3, 3.4)
15. [ ] Confirm there is **no "Or describe it…" CTA** (Tier-B, deferred).

## D. Edit / delete

16. [ ] Tap an entry → edit servings → save → macros recalc.
17. [ ] Delete an entry → it disappears → macros recalc.

## E. Targets — TDEE calculator (STORY-004, Conflict C2)

18. [ ] Tap the Target IconBtn (or hero EDIT) → Fuel Targets opens at `app/(app)/fuel/targets.tsx`. (AC 4.1)
19. [ ] Profile strip (Age/Sex/Height/Weight) + 5 activity chips + cut↔bulk goal slider; the sticky preview kcal updates **live** as you change activity/goal. (Conflict C2)
20. [ ] Macro editor: pick a preset (Maintain/Cut/Bulk) → splits update; switch to Custom → 3 sliders editable; set a split summing ≠100 → a warning chip appears (no auto-rebalance). (AC 4.2, 4.3, design.md § Risks)
21. [ ] Set water goal (cups). Save → `PUT /nutrition/targets` → back on Fuel, the ring reflects the new target + water goal. (AC 4.4, 4.6)
22. [ ] (If a trainer target exists in the DB with `set_by_user_id`) banner reads "Targets set by Coach <name>". (AC 4.5, cross-cuts § 1.5)

## F. Water (STORY-009)

23. [ ] Tap a water cup / the + IconBtn → count increases **with a haptic**; - decreases. (AC 9.1, 9.5)
24. [ ] The count persists across a screen leave/return.
25. [ ] (Time-travel or DB check) at user-local midnight the count resets to 0 for the new day. (AC 9.3)

## G. Recipes + Meals (STORY-005, 006, 007, 008)

26. [ ] Open Recipes (QuickAddRow or library route) → `<Segmented>` Meals / Recipes; lists render via FlashList; recipe photos via `expo-image`. (AC 5.1, 5.2, 5.3)
27. [ ] - Create → dropdown: Save meal / Create recipe / Snap recipe (**locked**, Tier B) / Import URL. (AC 5.4)
28. [ ] Create recipe manually: name + servings + ≥2 ingredients + instructions → Save → `POST /recipes` → server-materialised per-serving macros show on the card. Auto-estimate toggle is **disabled/locked**. (AC 6.1–6.4, Conflict C4)
29. [ ] Import URL: paste a Schema.org recipe URL (e.g. a BBC Good Food recipe) → form pre-fills → review → Save. **No AI pill.** (AC 8.1–8.4, Conflict C3)
30. [ ] Import a URL with no recipe microdata → graceful "couldn't read this page" state (server `422 no_recipe_microdata`), no crash.
31. [ ] Meals tab → + → "From logged" → today's logged foods grouped by slot → select some → name + Save → `POST /meals` → appears in Meals. (AC 7.1–7.3)

## H. Offline-first (decision #9)

32. [ ] Airplane mode → log an entry via Quick Add → it appears immediately + ring updates **optimistically**; a queued/syncing indicator shows. (design.md § Offline behaviour)
33. [ ] Increment water offline → count updates locally.
34. [ ] Reconnect → `sync_queue` flushes → `SELECT * FROM nutrition_entries WHERE user_id = ?` shows the entry; water reflects the **absolute** last value (not a doubled delta). (BACKEND_BRIEF § 4)
35. [ ] Offline barcode of a **previously cached** food → resolves from `cached_foods`. Offline barcode of an **uncached** food → "Food not in cache — connect to fetch from database." (no crash). (design.md § Offline behaviour)
        35a. [ ] **OFF seed (BACKEND_BRIEF § 9):** after the seed script runs, `SELECT count(*) FROM foods WHERE source='openfoodfacts'` is non-zero; scanning a **common seeded product** resolves with **no live OFF call** (check the egress/network log — served from the seeded `foods` row). The delta cron handler runs and logs `[off-delta:summary]` without error.
36. [ ] Kill + relaunch the app offline → the Fuel screen restores the last cached day (cold-boot read from `cached_fuel_today`).

## I. Tier-B locked (Conflict C4, C6)

37. [ ] Tap Snap → upgrade placeholder (no camera, no `/nutrition/ai/*` call fires — check the network log).
38. [ ] Snap-recipe in the Create dropdown is locked; auto-estimate-macros toggle is disabled.

## J. Streak (STORY-010)

39. [ ] Configure the test user's prior-day kcal to land within target ±10% (insert entries dated yesterday). Run the streak cron (`microservices/core/src/streakCron.ts` handler, or wait for 02:00 UTC) → `user_streaks` `nutrition_streak` `current_count` advances. (AC 10.1, 10.2)
40. [ ] Repeat with yesterday's total at +15% off target → `current_count` does **not** advance (freeze-token check / break per cross-cuts § 3.5).
41. [ ] If `daily_nutrition_target_hit` preference is on, a notification row inserts without an enum error. (Default off — so this is opt-in.)

## K. Security — SSRF on `/recipes/import` (design.md § Recipe-import SSRF guards)

42. [ ] `POST /recipes/import { url: "http://169.254.169.254/latest/meta-data/" }` → **400**, no fetch made (AWS metadata blocked).
43. [ ] Each private-range variant (`http://10.0.0.1/`, `http://127.0.0.1/`, `http://192.168.1.1/`, IPv6 `http://[::1]/`) → 400.
44. [ ] A public URL that 302-redirects to `http://169.254.169.254/…` → 400 (per-hop re-validation).
45. [ ] Disallowed scheme (`file://`, `gopher://`) → 400; oversized body (>2 MiB) → 400; slow host → 400/timeout within ~10s.

## L. Quality gates

46. [ ] Backend: `bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit` — green, ≥90% coverage on changed files.
47. [ ] Mobile: `tsc --noEmit`, `jest --coverage` (≥90%), eslint 0 warnings from `packages/mobile/`, prettier clean.
48. [ ] No secret values committed (repo is public).

---

If any step fails, capture the failing surface (network log / screenshot / SQL) and surface in PR review. Do NOT widen scope to fix an out-of-scope gap — flag it as a spec/brief amendment.

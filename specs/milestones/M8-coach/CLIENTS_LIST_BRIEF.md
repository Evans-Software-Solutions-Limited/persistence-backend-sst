# M8 Coach — Clients list (roster) brief

> Vertical slice, backend-then-frontend, one PR (two agents) — same shape as the Coach You
> slice (PR #123). Scope is the **Clients tab roster only**. Client Detail (the row-tap target)
> is the _next_ slice (10.9.3), not this one.

## Context

Coach mode is wired end-to-end (mode switch, tab bar, entitlement gates) and the **Coach You**
page + `trainers/` backend foundation shipped in PR #123. The **Clients** tab is still a
paywall/`ComingSoon` stub (`ClientsContainer` renders `FeatureGatePrompt` for unentitled users
and a `ComingSoon` placeholder for entitled trainers). This slice replaces that placeholder with
the real client roster — the core day-to-day coach surface and the entry point to every
per-client flow.

**Authoritative sources**

- Prototype (port 1:1): `~/Downloads/handoff/design-source/screens/coach.jsx` →
  `ClientsScreenV2` (lines 393–458), `SummaryChipV2` (460–472), `AdherenceLegend` (474–495),
  `LegendRange` (497–504), `ClientRowV2` (506–538).
- Spec: `specs/10-trainer-features/requirements.md` STORY-002; `design.md § Frontend — Clients
List`; `tasks.md` T-10.9.2.
- Reuse reference: PR #123's `microservices/core/src/application/trainers/` +
  `repositories/trainerRepository.ts`, and `packages/mobile/src/ui/{containers,presenters}/`
  Coach You files + the data-layer wiring (`useGetCoachOverview`, ApiPort/StoragePort additions).

---

## Backend slice (agent 1 — lands first)

One new read endpoint in the existing `trainers/` module. No migrations. Same pattern as
`trainers/overview/` (handler + `TrainerService` decorator + `TrainerRepository` methods,
trainer role-gated, registered in `api.ts`, vitest to 90%).

### `GET /trainers/me/clients` → `{ data: TrainerClient[] }`

```ts
type ClientStatus = "active" | "pending";
type ClientBand = "stellar" | "strong" | "wobbling" | "atRisk" | "crisis";
type ClientFlag = {
  tone: "gold" | "ember" | "error" | "trainer";
  label: string;
};

interface TrainerClient {
  id: string; // clientId (profiles.id)
  name: string;
  initials: string;
  avatarUrl: string | null;
  status: ClientStatus; // pt_client_relationships.status (active | pending)
  programLabel: string | null; // e.g. "Strength · Wk 4 / 12" — v1 NULL (see note)
  adherence: number | null; // v1 28-day, reuse getAdherenceRows
  band: ClientBand | null; // null when adherence is null (no assignments)
  lastSeenAt: string | null; // most recent completed session completedAt, ISO
  flags: ClientFlag[]; // NEW PR / N MISSED / Nd IDLE
}
```

**Reuse, don't reinvent** (all already in `trainerRepository.ts`):

- `getActiveClients(trainerId)` → the active, non-AI client set (name, createdAt). Extend the
  query (or add a sibling) to also include `status='pending'` rows and `avatarUrl`, since the
  roster shows pending clients too (prototype "All" filter + pending state).
- `getAdherenceRows(trainerId, clientIds, win)` → per-client completed/total over 28d →
  `clientAdherence()` → %.
- Missed-assignment + PR logic already exists inside `getRecentActivity` / `getClientPRsThisMonth`
  — lift the per-client counts out for the flags.

**v1 computations (document in code; confirm on PR):**

- `band` (5-level, per prototype `ClientRowV2`): `≥95 stellar`, `≥85 strong`, `≥65 wobbling`,
  `≥40 atRisk`, else `crisis`. Add a 5-band classifier next to the existing 3-band
  `adherenceBand()` (keep the 3-band one — the Coach You donut uses it). `null` adherence → no band.
- `flags`: `NEW PR` (gold) if ≥1 personal_record this month; `N MISSED` (ember) = count of this
  trainer's skipped/past-due assignments in the window; `Nd IDLE` (error) if `lastSeenAt` is
  older than N days (use 4 to match prototype "4d IDLE"). Trainer-scope every assignment query
  (PR #123 review: `eq(workoutAssignments.trainerId, trainerId)` — a co-trainer's data must not leak).
- `lastSeenAt`: most recent `workout_sessions.completedAt` for the client (status='completed').
- `programLabel`: **NULL in v1.** The prototype's "Strength · Wk 4 / 12" needs
  `program_assignments`, which doesn't exist until the Programs slice (10.4). Leave the field in
  the contract, return null, and the presenter hides the segment when null. Do NOT fabricate it.

Sort: by adherence ascending (lowest/at-risk first), matching the prototype "SORTED BY ·
ADHERENCE". Null-adherence clients sort last.

**Tests:** role guard (403 non-trainer), empty roster, band thresholds (all 5), flag derivation,
trainer-scoping (a co-trainer's assignment/PR doesn't appear), null-adherence client. 90% on new
repo methods + handler.

---

## Frontend slice (agent 2 — depends on backend)

### 1. `ClientsContainer` — keep the gate, swap the body

`packages/mobile/src/ui/containers/ClientsContainer.tsx` currently: spinner while sub loads →
`FeatureGatePrompt` if `useFeatureGate('trainer_clients')` denies → `ComingSoon` if allowed.
**Keep the first two branches exactly.** Replace the `ComingSoon` branch with the real roster:
wire `useGetTrainerClients()` + local search/filter state into `<ClientsListPresenter>`.

### 2. Data layer (offline-first, mirror the Coach You wiring from #123)

- Domain model `src/domain/models/trainerClient.ts` (the `TrainerClient` shape above).
- `ApiPort.getTrainerClients()` + impls in the SST adapter **and** the in-memory test double.
- `StoragePort.getCachedTrainerClients/cacheTrainerClients` (JSON blob keyed by userId) +
  both adapter impls.
- `useGetTrainerClients()` via `useCachedResource` (copy `useGetCoachOverview` structure).

### 3. `<ClientsListPresenter>` — port `ClientsScreenV2` 1:1

Layout (prototype `coach.jsx:405`): `<HeaderBar large>` title "Clients", eyebrow
`COACHING · {N} ACTIVE`, trailing `+` `IconBtn` (tone="trainer") that opens the existing
**AddClient sheet** (reuse `useAddClientSheet().openSheet` from #123 — invite already works).
Then: summary chip row (`SummaryChipV2` × 3 — "Need attention"/ember, "New PR"/gold, "Programme
ends"/trainer), `SearchBar`, `Segmented` (Active | All | Archive, accent="trainer"), the
"SORTED BY · ADHERENCE" header with an info toggle that expands `AdherenceLegend`, then the
client rows in a `Card pad={0}`.

`<ClientRowV2>` (prototype 506–538): Avatar (tone="trainer") + name + optional flag `Pill` +
`{programLabel · }{lastSeen} ago` subtitle + adherence `Bar` (tone by band) + `{adh}% · {band
label}` + chevron. Use `FlashList` per `design.md § Frontend — Clients List`. Row press →
`onOpenClient(id)`.

**v1 fidelity notes:**

- `programLabel` null → render just `{lastSeen} ago` (omit the "Strength · Wk 4 / 12" segment).
- "Programme ends" summary chip → 0 in v1 (no assignments yet); keep the chip, show 0.
- Row tap target (Client Detail) doesn't exist yet → `onOpenClient` should
  `router.push('/(app)/clients/' + id)`; add a minimal `app/(app)/clients/[id].tsx` `ComingSoon`
  stub so the tap doesn't crash. Client Detail proper is the next slice (10.9.3).

### 4. Tests (90%)

Presenter renders with a representative roster + empty state + null-adherence/null-programLabel
rows; band→tone mapping; segmented filter + search filter logic; legend toggle; container
hook-integration with the in-memory adapter; gate branch unchanged (non-trainer → paywall).

---

## Verification

- Backend: `bun run typecheck && bun run lint && bun run test:unit && bun run prettier:check`.
  Exercise `GET /trainers/me/clients` against a trainer-tier seed account with ≥2 clients.
- Frontend: same gates. Run Expo, sign in as a trainer, coach mode → Clients tab shows the roster
  (was the gated placeholder), search/filter work, the `+` opens the invite sheet, a row tap
  pushes the (stub) detail route. Non-trainer still sees the paywall.

## Out of scope (later slices)

Client Detail 5-tab screen (10.9.3 — next), Programs + `program_assignments` (10.4/10.12),
on-behalf actions + audit (10.1–10.3/10.10), trainer notes (10.5), Coach Home (needs a design
call vs Coach You first). Don't build a standalone `/trainers/me/recent-activity` — it's already
folded into `/trainers/me/overview`.

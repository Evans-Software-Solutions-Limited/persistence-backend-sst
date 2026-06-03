# 15 — Exercise AI Classification: Design

> Authored 2026-06-03. Implements `requirements.md`.

---

## Architecture overview

```
Mobile (04.3 sheet / 04.6 editor)
  └─ "Tag with AI" button
       └─ ExercisesApiPort.classifyExercise({ name, description?, instructions? })
            └─ sst-api.adapter → POST /exercises/classify  (Supabase JWT)
                 └─ exercisesClassifyHandler (Elysia, requireAuth)
                      ├─ validate body
                      ├─ build constrained prompt (allowed enum values inlined)
                      ├─ Groq chat/completions (llama-3.1-8b-instant, JSON, temp≈0)
                      ├─ parse + validate output against V2 enums (drop invalid)
                      └─ return { category?, difficulty?, primaryMuscleGroups?,
                                  secondaryMuscleGroups?, equipment? }
```

No DB, no cache, no sync queue. Pure request → inference → validated response.

---

## Backend

### Route — `microservices/core/src/application/exercises/classify/exercisesClassifyHandler.ts`

Modelled on `profilesAvatarHandler` (authed Elysia route, `Resource`-bound secret instead of bucket).

```ts
import Elysia, { t } from "elysia";
import { Resource } from "sst";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { classifyExercise } from "./groqClassifier";

export const exercisesClassifyHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/exercises/classify",
    async (ctx) => {
      getUser(ctx); // ensure authed; userId only needed for rate-limit keying
      const result = await classifyExercise(ctx.body); // throws ClassifyError on upstream failure
      return { data: result };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2, maxLength: 200 }),
        description: t.Optional(t.String({ maxLength: 5000 })),
        instructions: t.Optional(t.String({ maxLength: 10000 })),
      }),
    },
  );
```

### Inference + mapping — `groqClassifier.ts` (unit-testable)

Ports the legacy `classifyExerciseWithGroq` + `mapAIClassificationToDatabase`. The Groq call is injected (a `fetchChatCompletion` fn) and the reference lists are passed in, so tests run without network or DB. Two layers:

```ts
export type ClassifyInput = { name: string; description?: string; instructions?: string };
export type ClassifyResult = {
  category?: ExerciseCategory;          // static enum (lowercased)
  difficulty?: ExerciseDifficulty;      // static enum (lowercased)
  primaryMuscleGroups?: string[];       // muscle_groups UUIDs
  secondaryMuscleGroups?: string[];     // muscle_groups UUIDs
  equipment?: string[];                 // equipment_types UUIDs
};

type RefLists = {
  muscleGroups: { id: string; name: string }[];
  equipmentTypes: { id: string; name: string }[];
};

// PURE — maps the raw AI JSON to ClassifyResult given the reference lists.
//   - category/difficulty: trim → lowercase → keep iff in the static enum.
//   - primary/secondary muscles, equipment: AI returns NAMES → match
//     case-insensitively against ref-list names → emit the UUID; drop unmatched.
//   - region_type / movement_type / accessibility_requirements: parsed by the
//     legacy fn but DROPPED here (no V2 columns).
// Heaviest unit coverage: every enum, casing, unknown-value, empty/partial/
// non-object input, name-with-no-UUID-match, deduping.
export function mapClassification(raw: unknown, refs: RefLists): ClassifyResult { … }

// Builds the prompt (inlining ref-list names), calls Groq, parses, maps.
// 10s AbortController timeout; throws ClassifyError on non-2xx / parse fail / timeout.
export async function classifyExercise(input: ClassifyInput, deps: {...}): Promise<ClassifyResult> { … }
```

**Prompt** — port the legacy system+user prompt verbatim (it's well-tuned): the expert-trainer system prompt enumerates category/difficulty/region/movement guidance and inlines the **exact allowed muscle + equipment display names** fetched from `muscle_groups` / `equipment_types` ("use EXACT database values, case-sensitive; do NOT use scientific names"). The user prompt asks for the strict JSON object shape. We keep region_type/movement_type in the prompt (cheap, helps the model reason) but drop them from the mapped result. Reference lists are read via the existing repository/DB layer the core service already has (the V2 backend talks to the same Supabase DB — see memory `project_supabase_db_as_is`).

Groq call params (verbatim from legacy): `model: "llama-3.1-8b-instant"`, `temperature: 0.3`, `response_format: { type: "json_object" }`, `max_tokens: 1000`, plus a 10s `AbortController` timeout (the one addition). On non-2xx / parse failure / timeout → `ClassifyError` → handler 502 `{ error }`.

### Secret + binding

- `infra/secrets.ts`: `export const groqApiKey = new sst.Secret("GroqApiKey");`
- `infra/api.ts`: add `groqApiKey` to the API's `link: [...]`.
- Handler reads `Resource.GroqApiKey.value` (same `Resource` cast pattern the avatar handler uses for `Avatars` until `sst-env.d.ts` regenerates).

### Rate limiting (STORY-003)

Lightweight per-user limit keyed on the JWT `sub`. Simplest viable: an in-memory token bucket per Lambda container (best-effort; resets on cold start) returning 429 when exceeded. (A durable cross-Lambda limiter is out of scope — note it; the in-memory cap is enough to blunt accidental loops at onboarding.)

---

## Mobile

### Port + adapter

- `domain/ports/api.port.ts`: add `classifyExercise(input: ClassifyInput): Promise<Result<ClassifyResult, ApiError>>` to the exercises section.
- `adapters/api/sst-api.adapter.ts`: implement via the existing authed `request` helper → `POST /exercises/classify`. Map snake/camel as the other exercise methods do.
- `adapters/api/__tests__/in-memory-api.adapter.ts`: a stub returning a canned `ClassifyResult` so container tests are deterministic.

### UI — `<ExerciseFormFields>` + presenters

- Add an optional `onTagWithAI?: () => void` + `isTagging?: boolean` to `<ExerciseFormFields>` (or render the button in the composing presenter so the shared component stays presentational). Button disabled until name ≥ 2 chars and while tagging or offline.
- The container (sheet: `CreateExerciseSheetContainer`; editor: 04.6) calls `classifyExercise`, then maps `ClassifyResult` → the form's `NewExerciseInput`. The result's muscle/equipment are **UUIDs**, so:
  - `category`/`difficulty` → `level` label (reverse of `LEVEL_TO_DIFFICULTY`).
  - Resolve each muscle/equipment UUID → display label via the **reference-list cache** the exercise adapter already maintains (the same one the cards use for `*Labels`).
  - Sheet: map the resolved primary muscle **label** → nearest coarse `MuscleLabel`; secondaries → coarse labels (deduped, minus primary); equipment label → `EquipmentLabel`.
  - Editor (04.6, granular) applies the resolved labels directly — no coarse collapse.
- Online-gate via the existing NetInfo adapter; disabled + hinted offline.

### Label → coarse reverse map

Add to `exerciseForm.ts` a `MUSCLE_LABEL_DISPLAY_TO_COARSE` helper mapping a resolved muscle display label → the coarse `MuscleLabel` (e.g. `Lats`/`Back → Back`, `Quads`/`Hamstrings/Glutes/Calves → Legs`, `Biceps/Triceps/Forearms → Arms`). Pure + unit-tested. (UUID → label resolution stays in the adapter's reference cache; this map only collapses labels → the 6 coarse buckets.)

---

## Testing strategy

- **Unit (heaviest):** `mapClassification(raw, refs)` — every category/difficulty enum + casing, name→UUID match (hit/miss/case-insensitive), unmatched dropped, dedupe, empty/partial/non-object input, region/movement/accessibility dropped. `classifyExercise` with an injected fake completion (success, malformed JSON, timeout, non-2xx).
- **Handler:** body validation (400s), auth (401), success shape `{ data }`, upstream failure → 502. Groq fetch + ref-list reads mocked.
- **Mobile:** adapter maps request/response; the label→coarse map; container maps `ClassifyResult` (UUIDs) → `NewExerciseInput` via the reference cache; button disabled states (short name / tagging / offline); failure leaves the form untouched.
- **Coverage:** ≥ 90% on changed files; `mapClassification` + the label→coarse map at/near 100% branches.

---

## Risks + mitigations

| Risk                                                   | Mitigation                                                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8B model returns invalid/hallucinated tags             | category/difficulty enum-validated; muscle/equipment names matched against the ref lists → unmatched dropped; prompt inlines the exact allowed names; fall back to `llama-3.3-70b-versatile` if accuracy regresses. |
| Cost blowout during onboarding                         | Cheap model, `max_tokens: 1000`, temp 0.3 (legacy params), per-user rate limit (new), short input caps.                                                                                                             |
| Groq outage / latency                                  | 10s timeout, clean 502, non-blocking client UX — manual entry always works.                                                                                                                                         |
| UUID→label→coarse collapse loses fidelity in the sheet | Acceptable for v1 (sheet is coarse by design); 04.6 editor applies resolved labels. Documented.                                                                                                                     |
| Leaking the API key                                    | Read from SST Secret only; never logged; not returned to client.                                                                                                                                                    |

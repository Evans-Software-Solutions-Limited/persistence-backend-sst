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

### Inference + validation — `groqClassifier.ts` (pure-ish, unit-testable)

The Groq call is injected (a `fetchChatCompletion` fn) so tests run without network. The validator is a pure function over the V2 enums and is the coverage-critical piece.

```ts
import {
  EXERCISE_CATEGORIES, EXERCISE_DIFFICULTIES, MUSCLE_GROUPS, EQUIPMENT_TYPES,
  type ExerciseCategory, type ExerciseDifficulty, type MuscleGroup, type EquipmentType,
} from "<shared exercise enums>"; // backend mirror of packages/db enums

export type ClassifyInput = { name: string; description?: string; instructions?: string };
export type ClassifyResult = {
  category?: ExerciseCategory;
  difficulty?: ExerciseDifficulty;
  primaryMuscleGroups?: MuscleGroup[];
  secondaryMuscleGroups?: MuscleGroup[];
  equipment?: EquipmentType[];
};

// PURE — maps/validates raw AI JSON to the V2 enum subset. Unknown values dropped,
// undeterminable fields omitted. This is the heart of decision #5 and gets the
// heaviest unit coverage (every enum, casing, unknown-value, partial-object case).
export function validateClassification(raw: unknown): ClassifyResult { … }
```

**Prompt shape** (system + user). The system prompt inlines the exact allowed values so the model can only choose from V2 enums, and demands strict JSON:

```
You are a fitness-exercise tagger. Given an exercise, return ONLY a JSON object with these
optional keys. Use ONLY the listed allowed values; omit a key if unsure.
  category: one of [strength, cardio, flexibility, balance, plyometric, olympic, mobility]
  difficulty: one of [beginner, intermediate, advanced, expert]
  primaryMuscleGroups: array from [chest, back, shoulders, biceps, triceps, quadriceps,
    hamstrings, glutes, calves, core, forearms, traps, lats, hip_flexors, abductors, adductors]
  secondaryMuscleGroups: array from the same set (exclude any in primary)
  equipment: array from [barbell, dumbbell, machine, cable, bodyweight, kettlebell,
    resistance_band, smith_machine, ez_bar, other]
No prose, no markdown — JSON only.
```

User message: the name + description + instructions. Call with `response_format: { type: "json_object" }`, `temperature: 0`, `max_tokens: ~300`, a 10s `AbortController` timeout. On non-2xx / parse failure / timeout → throw `ClassifyError` → handler returns 502 `{ error }`.

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
- The container (sheet: `CreateExerciseSheetContainer`; editor: 04.6) calls `classifyExercise`, then maps `ClassifyResult` → the form's `NewExerciseInput`:
  - `category`/`difficulty` → `level` label (reverse of `LEVEL_TO_DIFFICULTY`).
  - `primaryMuscleGroups[0]` → nearest **coarse** `MuscleLabel` for the sheet picker (granular→coarse reverse map); `secondaryMuscleGroups` → coarse labels (deduped, minus primary).
  - `equipment[0]` → `EquipmentLabel`.
  - The 04.6 editor (if it exposes granular muscles) applies granular directly — no coarse collapse.
- Online-gate via the existing NetInfo adapter; disabled + hinted offline.

### Granular → coarse reverse map

Add to `exerciseForm.ts` a `MUSCLE_GROUP_TO_COARSE: Record<MuscleGroup, MuscleLabel>` (inverse of `MUSCLE_LABEL_TO_GROUPS`, e.g. `lats → Back`, `quadriceps → Legs`, `biceps → Arms`). Pure + unit-tested.

---

## Testing strategy

- **Unit (heaviest):** `validateClassification` — every enum, mixed casing, unknown values dropped, arrays filtered, partial objects, empty object, non-object input. `groqClassifier` with an injected fake completion (success, malformed JSON, timeout, non-2xx).
- **Handler:** body validation (400s), auth (401), success shape `{ data }`, upstream failure → 502. Groq fetch mocked.
- **Mobile:** adapter maps request/response; container maps `ClassifyResult` → `NewExerciseInput` (incl. granular→coarse); button disabled states (short name / tagging / offline); failure leaves the form untouched.
- **Coverage:** ≥ 90% on changed files; the validator + reverse-map at/near 100% branches.

---

## Risks + mitigations

| Risk                                                 | Mitigation                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8B model returns invalid/hallucinated tags           | Strict server-side enum validation drops anything off-list; prompt inlines allowed values; fall back to `llama-3.3-70b-versatile` if accuracy is poor in testing. |
| Cost blowout during onboarding                       | Cheapest model, low `max_tokens`, temp 0, per-user rate limit, short input caps.                                                                                  |
| Groq outage / latency                                | 10s timeout, clean 502, non-blocking client UX — manual entry always works.                                                                                       |
| Granular→coarse collapse loses fidelity in the sheet | Acceptable for v1 (sheet is coarse by design); 04.6 editor applies granular. Documented.                                                                          |
| Leaking the API key                                  | Read from SST Secret only; never logged; not returned to client.                                                                                                  |

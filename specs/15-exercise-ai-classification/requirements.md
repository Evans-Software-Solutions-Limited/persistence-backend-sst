# 15 — Exercise AI Classification: Requirements

> **New spec, authored 2026-06-03.** Ports the legacy "classify exercise with AI" feature (a Supabase edge function in the legacy stack) onto the SST backend, and wires it into the V2 Create-Exercise sheet (04.3) + the exercise editor (04.6). Net-new backend — this spec is explicitly allowed to add an SST route + an AI-provider secret (04's STORY-009 froze 04's backend, not this one).

---

## Overview

When a user types an exercise name (optionally a description / instructions), they can tap **"Tag with AI"** and the backend returns suggested metadata — category, difficulty, primary/secondary muscles, equipment — which pre-fills the form. The user can then accept or adjust before saving. This mirrors the legacy mobile app's `usePostClassifyExercise()` flow, which called a Supabase edge function described in-code as "Uses Groq AI to automatically tag exercises with metadata."

Brad's intent (2026-06-02): replicate the legacy logic, but pick a **cheap + effective** AI service because classification is expected to run heavily during onboarding (users bulk-creating their exercise library). Cost is the primary driver.

Legacy references:

- `../persistence-backend/supabase/functions/post-classify-exercise/index.ts` — **the actual legacy edge function** (Groq call, full prompt, enum validation, name→UUID mapping). This spec replicates its logic on SST. Port it faithfully.
- `../persistence-mobile/hooks/api/usePostClassifyExercise.ts` — the mobile hook (request/response contract, auth, input validation).
- `../persistence-mobile/app/exercise-creator.tsx:46,207–237` — the `classificationMode: 'ai' | 'manual' | null` UX: user chooses AI or manual; after AI tagging the accordions show the (editable) suggested values.

V2 references:

- `packages/mobile/src/ui/components/exercises/ExerciseFormFields/` — the form the suggestions pre-fill (04.3).
- `microservices/core/src/application/exercises/` — where the new route lands.
- `microservices/core/src/application/profiles/avatar/profilesAvatarHandler.ts` + `infra/secrets.ts` — patterns for a new authed route + a new SST Secret.

---

## Locked decisions

| #   | Decision               | Locked value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI provider            | **Groq** (`POST https://api.groq.com/openai/v1/chat/completions`), OpenAI-API-compatible (no bespoke SDK). Model + call params **copied verbatim from the legacy edge fn** (`persistence-backend/supabase/functions/post-classify-exercise/index.ts`): `model: "llama-3.1-8b-instant"`, `temperature: 0.3`, `response_format: { type: "json_object" }`, `max_tokens: 1000`. `llama-3.3-70b-versatile` is the documented fallback if 8B accuracy regresses.                                                                                                                                                                                                                                   |
| 2   | Endpoint               | `POST /exercises/classify` on the existing core API. Authed (Supabase JWT, `requireAuth`). No DB writes — pure inference + validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | Secret                 | New `sst.Secret("GroqApiKey")` in `infra/secrets.ts`, linked to the API in `infra/api.ts`. Set per-stage via `bunx sst secret set GroqApiKey …`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Response fields        | V2 only returns what the V2 `Exercise` model can store: `category`, `difficulty`, `primaryMuscleGroups`, `secondaryMuscleGroups`, `equipment`. The legacy extras (`region_type`, `movement_type`, `accessibility_requirements`) are **dropped** — V2 has no columns for them.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | Output mapping         | Replicates the legacy edge fn exactly. **category / difficulty**: AI returns a string → lowercase → validate against the static enum (`EXERCISE_CATEGORIES` / `EXERCISE_DIFFICULTIES`), drop if not a member. **muscles / equipment**: the prompt inlines the allowed **display names** fetched from the reference tables (`muscle_groups`, `equipment_types`); the AI returns those names; the server maps each name → its reference-list **UUID** (case-insensitive exact match), dropping unmatched. So the endpoint returns muscle/equipment **UUIDs** — exactly what a V2 `Exercise` stores at runtime (per the Exercise-model docstring). Any field the AI can't determine is omitted. |
| 6   | Sheet vs editor wiring | Suggestions return muscle/equipment **UUIDs**. The mobile side resolves each UUID → display label via the reference-list cache the exercise adapter already maintains, then for the 04.3 coarse picker maps label → nearest coarse `MuscleLabel`; the 04.6 editor (granular) applies the resolved labels directly. The "Tag with AI" button is disabled until name ≥ 2 chars.                                                                                                                                                                                                                                                                                                                |
| 7   | Failure handling       | Network/timeout/AI error → non-blocking toast/alert ("Couldn't tag automatically — fill it in manually"); the form is untouched. Classification is always optional; manual entry is the baseline path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 8   | Cost guardrails        | Server caps input (name ≤ 200, description ≤ 5000, instructions ≤ 10000 — mirrors legacy), the legacy `max_tokens: 1000` / `temperature: 0.3` call params (decision #1), and a per-user rate limit (see STORY-003) — the legacy fn had no rate limit, which is the one deliberate addition for onboarding-scale cost safety.                                                                                                                                                                                                                                                                                                                                                                 |

---

## User stories

### STORY-001: As a user, I want AI to suggest an exercise's tags so I don't have to fill them in manually

**Acceptance Criteria:**

- 1.1 [ ] A **"Tag with AI"** action appears in the Create-Exercise sheet (04.3) and the exercise editor (04.6), disabled until the name is ≥ 2 chars.
- 1.2 [ ] Tapping it sends `{ name, description?, instructions? }` to `POST /exercises/classify` with the user's JWT.
- 1.3 [ ] On success, the returned fields pre-fill the form: category, difficulty/level, primary muscle, secondary muscles, equipment. Existing user-entered values are overwritten by suggestions (matches legacy `setValue`), then remain fully editable.
- 1.4 [ ] While in flight, the action shows a loading state and is disabled (no double-submit).
- 1.5 [ ] On failure, a non-blocking message shows and the form is left as-is (1.7 of legacy parity).
- 1.6 [ ] Works only online; offline the action is disabled with a hint (classification needs the network — it is NOT queued).

### STORY-002: As the backend, I want to classify an exercise via a cheap AI provider and return only valid V2 enums

**Acceptance Criteria:**

- 2.1 [ ] `POST /exercises/classify` validates the body (`name` required ≥ 2 chars; `description` ≤ 5000; `instructions` ≤ 10000) and 400s on violation.
- 2.2 [ ] It fetches the allowed muscle + equipment **display names** from the reference tables and inlines them into the system prompt (case-sensitive exact-value instruction, as the legacy fn does), then calls Groq with the decision-#1 params.
- 2.3 [ ] The JSON response is mapped per decision #5: category/difficulty → lowercased + static-enum-validated; muscle/equipment names → reference-list **UUIDs** (case-insensitive exact match); invalid/unmatched values dropped; undeterminable fields omitted.
- 2.4 [ ] Returns `{ category?, difficulty?, primaryMuscleGroups?, secondaryMuscleGroups?, equipment? }` where muscle/equipment arrays are **UUIDs**. Never throws raw AI errors to the client — wraps as a clean 502 `{ error }` on upstream failure.
- 2.5 [ ] No DB writes. No PII beyond the exercise text is sent to Groq.
- 2.6 [ ] The Groq API key is read from the SST Secret, never logged.

### STORY-003: As the operator, I want classification to be cost-safe at onboarding scale

**Acceptance Criteria:**

- 3.1 [ ] Per-user rate limit (e.g. ≤ N calls/min) — exceeding returns 429; the client surfaces a gentle "slow down" message.
- 3.2 [ ] Upstream timeout (e.g. 10s) so a slow/hung Groq call can't pin a Lambda.
- 3.3 [ ] `max_tokens` and `temperature` are bounded (decision #8) so each call is small + deterministic.

---

## Out of scope

- The legacy `region_type` / `movement_type` / `accessibility_requirements` fields (no V2 columns). If they're ever added, extend decision #4.
- Image-based classification (classifying from a photo) — text-only, like legacy.
- Bulk / batch classification — one exercise per call.
- Offline queueing of classification — it's an online-only convenience.
- The media-upload feature — owned by `16-exercise-media-upload`.

---

## Dependencies and what this spec unlocks

- **Depends on:** 04.3 (`<ExerciseFormFields>` + the Create-Exercise sheet) being merged, since the button + pre-fill live there. 04.6 editor reuses the same wiring.
- **Adds:** the first AI-provider integration + secret in the SST backend — establishes the pattern for any future AI features.

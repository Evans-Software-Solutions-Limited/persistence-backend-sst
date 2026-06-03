# 15 — Exercise AI Classification: Requirements

> **New spec, authored 2026-06-03.** Ports the legacy "classify exercise with AI" feature (a Supabase edge function in the legacy stack) onto the SST backend, and wires it into the V2 Create-Exercise sheet (04.3) + the exercise editor (04.6). Net-new backend — this spec is explicitly allowed to add an SST route + an AI-provider secret (04's STORY-009 froze 04's backend, not this one).

---

## Overview

When a user types an exercise name (optionally a description / instructions), they can tap **"Tag with AI"** and the backend returns suggested metadata — category, difficulty, primary/secondary muscles, equipment — which pre-fills the form. The user can then accept or adjust before saving. This mirrors the legacy mobile app's `usePostClassifyExercise()` flow, which called a Supabase edge function described in-code as "Uses Groq AI to automatically tag exercises with metadata."

Brad's intent (2026-06-02): replicate the legacy logic, but pick a **cheap + effective** AI service because classification is expected to run heavily during onboarding (users bulk-creating their exercise library). Cost is the primary driver.

Legacy references:

- `../persistence-mobile/hooks/api/usePostClassifyExercise.ts` — the mobile hook (request/response contract, auth, validation). The edge function body itself lived in the legacy Supabase project (not in the mobile repo), so this spec replicates the **contract + behaviour**, not byte-for-byte prompt text.
- `../persistence-mobile/app/exercise-creator.tsx:46,207–237` — the `classificationMode: 'ai' | 'manual' | null` UX: user chooses AI or manual; after AI tagging the accordions show the (editable) suggested values.

V2 references:

- `packages/mobile/src/ui/components/exercises/ExerciseFormFields/` — the form the suggestions pre-fill (04.3).
- `microservices/core/src/application/exercises/` — where the new route lands.
- `microservices/core/src/application/profiles/avatar/profilesAvatarHandler.ts` + `infra/secrets.ts` — patterns for a new authed route + a new SST Secret.

---

## Locked decisions

| #   | Decision               | Locked value                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | AI provider            | **Groq** (`POST https://api.groq.com/openai/v1/chat/completions`). Matches the legacy stack ("Groq AI"), is among the cheapest + fastest providers, and is OpenAI-API-compatible (no bespoke SDK). Model: `llama-3.1-8b-instant` (cheapest/fastest; sufficient for constrained classification with a tight prompt + server-side enum validation). `llama-3.3-70b-versatile` is the documented fallback if 8B accuracy proves insufficient. |
| 2   | Endpoint               | `POST /exercises/classify` on the existing core API. Authed (Supabase JWT, `requireAuth`). No DB writes — pure inference + validation.                                                                                                                                                                                                                                                                                                     |
| 3   | Secret                 | New `sst.Secret("GroqApiKey")` in `infra/secrets.ts`, linked to the API in `infra/api.ts`. Set per-stage via `bunx sst secret set GroqApiKey …`.                                                                                                                                                                                                                                                                                           |
| 4   | Response fields        | V2 only returns what the V2 `Exercise` model can store: `category`, `difficulty`, `primaryMuscleGroups`, `secondaryMuscleGroups`, `equipment`. The legacy extras (`region_type`, `movement_type`, `accessibility_requirements`) are **dropped** — V2 has no columns for them.                                                                                                                                                              |
| 5   | Output validation      | The AI's free-text output is mapped + validated **server-side** against the V2 enums (`EXERCISE_CATEGORIES`, `EXERCISE_DIFFICULTIES`, `MUSCLE_GROUPS`, `EQUIPMENT_TYPES`). Unrecognised values are dropped (never returned). A field the AI can't determine is omitted (optional).                                                                                                                                                         |
| 6   | Sheet vs editor wiring | Suggestions return **granular** muscle enums. The 04.3 sheet's coarse picker maps granular → nearest coarse label when applying; the 04.6 full-screen editor applies granular directly. The "Tag with AI" button is disabled until name ≥ 2 chars.                                                                                                                                                                                         |
| 7   | Failure handling       | Network/timeout/AI error → non-blocking toast/alert ("Couldn't tag automatically — fill it in manually"); the form is untouched. Classification is always optional; manual entry is the baseline path.                                                                                                                                                                                                                                     |
| 8   | Cost guardrails        | Server caps input (name ≤ 200, description ≤ 5000, instructions ≤ 10000 — mirrors legacy), `max_tokens` small, `temperature` low (0–0.2) for determinism, and a per-user rate limit (see STORY-003).                                                                                                                                                                                                                                       |

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
- 2.2 [ ] It calls Groq (`llama-3.1-8b-instant`) with a constrained JSON-output prompt listing the exact allowed enum values, low temperature, small `max_tokens`.
- 2.3 [ ] The response is parsed as JSON; each field is validated against the V2 enum sets; invalid/unknown values are dropped; undeterminable fields are omitted.
- 2.4 [ ] Returns `{ category?, difficulty?, primaryMuscleGroups?, secondaryMuscleGroups?, equipment? }`. Never throws raw AI errors to the client — wraps as a clean 502 `{ error }` on upstream failure.
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

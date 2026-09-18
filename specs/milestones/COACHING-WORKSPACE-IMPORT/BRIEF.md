# Coaching workspace, import and athlete review — scope handoff

18 September 2026. Research/specification package for discussion; implementation and evaluations remain pending. Current main inspected: `162ba03a`. The previous Together/discovery package remains separate.

## Recommendation

Build one connected path: **bring or describe a plan → review it → schedule/assign → log → understand progress together**. Prioritize faithful import, desktop authoring and a shared athlete review. Do not duplicate the importer already scoped in spec 22 or grant coach permissions to Premium Plus athletes.

Read [Relay comparison and code findings](RESEARCH-2026-09-18.md). The comparison covers public claims, not a hands-on Relay benchmark. Persistence evidence is current source, not a fresh production audit.

## Biggest technical prerequisite: faithful scheduling and prescriptions

**Dependency FND-01 — implement before full programme-import acceptance.** Persistence currently repeats an ordered workout cycle with evenly spaced dates. It cannot faithfully retain arbitrary weekdays, irregular weeks, changing weekly loads/reps or deload prescriptions. An importer must not flatten those differences into the existing cycle.

Scope: additive explicit schedules, versioned per-occurrence prescriptions, owner/self authoring and compatible assignment/session-start behaviour. Preserve existing cycles, populated data, completed/in-progress workouts and older clients. Backend scheduling owner leads this; importer, desktop editor and personal planning consume the agreed contract.

Proof needed: round-trip a six-week programme with fixed weekdays, changing loads, a deload and two sessions on one day; then assign, start and log it without losing prescriptions. Concurrent updates must not rewrite an active/completed session. Since current workout starts are local, the spike must also prove cached/offline-start and delayed-sync behaviour; a server-only version check is insufficient. See spec 36 W1/W2 and design D2. Research, corpus preparation, wireframes and shared metric work can proceed independently while this dependency is resolved.

## Work packages

| Brief                                                  | Authority                      | Main ownership / dependencies                                                                                          |
| ------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [Programme, workout and voice import](IMPORT_BRIEF.md) | Spec 22 MI-1–8, §10, MI-T0–6   | Evaluation, backend worker/draft/accept; web/mobile capture and review. Explicit schedules depend on spec 36.          |
| [Conversation-to-programme](VOICE_DESIGN_BRIEF.md)     | Spec 22 GD-1–4, §10.6, GD-T1–2 | Explicit generative design, coaching preferences and review. Reuses import/validation, not another tool-driven writer. |
| [Web workspace and athlete review](WORKSPACE_BRIEF.md) | Spec 36 WS-1–9, D1–5, W0–7     | Programme/self backend, shared metrics; web editor and mobile review. One owner for schedule/prescription changes.     |
| [Exercise-library import](EXERCISE_IMPORT_BRIEF.md)    | Spec 37 EX-1–7, D1–4, E0–4     | Catalogue parser/mapping/duplicates; consumes shared import storage and aliases used by programme resolution.          |
| [Acceptance and pilot](SMOKE_TEST.md)                  | All above                      | Integrated evidence, privacy/access tests and real correction-time validation.                                         |

For an agent, use: “Work from the linked brief and parent requirements/design/tasks. First complete its current phase and contract/evaluation dependencies; do not treat pending quality gates as passed. Own the named modules, preserve parallel work, and return evidence mapped to acceptance criteria. No native builds, paid provider activation, external recruitment or production changes are authorized by this research handoff.” Subsequent implementation instructions can authorize ordinary coding within a selected brief.

## Architecture and parallelism

Backend owner A defines shared import sources/jobs/drafts/metering and atomic programme accept. Backend owner B defines additive schedule/prescription revisions, self routes and shared review projection; both agree normalized draft types before dependent implementation. Catalogue owner consumes A's infrastructure rather than inventing another upload/job system. Web owns `/workspace`; mobile owns contextual Train/Programs and review surfaces. Share pure contracts/validation, not role-specific screens. Serialize schema migrations and shared API exports through one integration owner.

Corpus/protocol preparation, UI wireframes and existing-source/permission audit can proceed concurrently. Real generation and import deployment wait for their modality gates; native voice/PDF capture waits for Brad's compatible build. Record blocked external evidence while completing independent design work.

## Working product decisions

Requested: imports for Premium Plus and coaches; personal planning/progress without coaching access; shared client view. Recommended: all paid coach tiers, all coached clients can read shared review without an extra athlete upgrade, self-generated AI on eligible personal tiers, private coach notes never shared automatically. The coached-client tier clarification is pending. Treat these as reviewable defaults, not individually confirmed decisions.

Required discussion before release: access answer; measured AI budgets/limits; import and generation quality bars; supported complex prescription/schedule cases; final raw source/provider retention; authorized source corpus/pilot participants. No arbitrary public campaign or external integration is bundled in this work.

## Delivery sequence

1. **Prove fidelity:** representative documents/audio/catalogue exports and schedule round trips; first draft of reviewed capability contract.
2. **Build foundations:** explicit schedules/self ownership, import draft/accept and safe shared metrics. Preserve existing cycles and access.
3. **Build experiences:** web workspace, mobile import/self review, exercise migration and independently evaluated source types.
4. **Add assisted design:** coaching preferences and conversation edits with clear proposed values; no autonomous assignment.
5. **Release with evidence:** compatibility, security, real devices, correction-time pilot and measured budget. Internal sequencing does not imply that users must accept a half-working import.

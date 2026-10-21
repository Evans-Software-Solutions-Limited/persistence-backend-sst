# Tasks

## Phase 0, decision and framing

- [ ] Confirm working product name (`Reps Coach`, `AI PT`, or another name)
- [ ] Confirm whether this lives under the Reps brand or stands alone initially
- [ ] Lock the product boundary: wellness coaching, not diagnosis
- [ ] Define the first commercial target: consumer only, or consumer with future trainer path

## Phase 1, product spec completion

- [ ] Create `product.md` steering doc with personas, pains, market angle, and positioning
- [ ] Create `tech.md` steering doc with SST conventions, AI boundaries, and storage rules
- [ ] Create `structure.md` steering doc with monorepo package layout
- [ ] Review and tighten `requirements.md` to a true MVP cut
- [ ] Add requirement priority labels: P0, P1, P2
- [ ] Add explicit non-goals section

## Phase 2, architecture and data design

- [ ] Design the core entities: user profile, goals, plan, check-in, metrics, media, summary, reminder
- [ ] Define photo upload and storage flow
- [ ] Define async analysis pipeline for image and weekly summary jobs
- [ ] Define recommendation guardrails and escalation rules
- [ ] Design consent, retention, and deletion handling for photo and health-like data

## Phase 3, AI coach design

- [ ] Specify onboarding coach flow
- [ ] Specify daily coach flow
- [ ] Specify weekly review flow
- [ ] Specify image-analysis output schema
- [ ] Specify confidence and uncertainty handling rules
- [ ] Define when the coach should ask questions versus recommend action directly

## Phase 4, SST implementation planning

- [ ] Map shared schemas into `core/`
- [ ] Map APIs and jobs into `functions/`
- [ ] Map infrastructure resources into `infra/`
- [ ] Decide first client surface: mobile app, web app, or chat-first experience
- [ ] Define queues/cron jobs for reminders, summaries, and photo analysis
- [ ] Define environment variables and secret requirements

## Phase 5, MVP build order

- [ ] Build onboarding and profile capture
- [ ] Build simple goal-based training plan generation
- [ ] Build calorie/protein and meal-structure guidance
- [ ] Build check-ins and accountability reminders
- [ ] Build weekly review summary
- [ ] Build photo upload and visual-progress analysis
- [ ] Build safety messaging and escalation patterns

## Phase 6, validation

- [ ] Test with 3 to 5 realistic user archetypes
- [ ] Pressure-test retention risk: will users still use this after week 2?
- [ ] Pressure-test hallucination and overclaim risk on image/data analysis
- [ ] Validate that recommendations are useful without pretending to be clinical
- [ ] Decide whether trainer mode deserves a separate follow-on spec

## Recommended immediate next step

If you want to move this properly, the next deliverable should be:

- `product.md`
- `tech.md`
- `structure.md`
- a tighter MVP cut of the current requirements

That would give you the real build-ready spec baseline.

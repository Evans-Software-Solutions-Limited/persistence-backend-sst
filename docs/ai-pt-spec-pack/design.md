# Design

## 1. Product shape

This should be built as a **separate product line adjacent to Persistence**, not as a small feature inside it.

Recommended positioning:

- consumer-facing AI PT / coach
- always-on accountability and planning layer
- optional trainer mode later

Why this split matters:

- different onboarding depth
- different memory model
- different risk/compliance posture
- different product rhythm from a gym log app

## 2. Adapted Kiro-style workflow

For this product, use a lightweight four-layer spec system:

### A. Steering docs

- `product.md` — market, personas, positioning, compliance boundary
- `tech.md` — SST monorepo standards, AI service patterns, storage rules
- `structure.md` — repo/package conventions

### B. Feature specs

Each meaningful feature gets:

- `requirements.md`
- `design.md`
- `tasks.md`

### C. Agent behaviour docs

- `agent-flow.md` for runtime interaction logic
- prompt/policy files later, once product direction is stable

### D. Review gates

Human approval between:

- requirements complete
- design complete
- build-ready tasks complete

## 3. SST monorepo fit

Use the existing SST monorepo template shape:

- `core/` — shared domain models, validation schemas, prompt contracts, shared utilities
- `functions/` — API handlers, async jobs, image-analysis orchestration, reminders, check-ins
- `scripts/` — admin scripts, migrations, backfills, support utilities
- `infra/` — API, queues, storage, scheduled jobs, secret wiring

Suggested additional app structure once implementation starts:

- `apps/mobile/` or `apps/web/` for the user-facing client
- `core/ai/` for coaching logic contracts and schemas
- `core/domain/` for plans, nutrition, check-ins, media, metrics
- `functions/jobs/` for weekly reviews, reminders, stalled-user nudges

## 4. Core domains

### User profile

Stores:

- goal type
- starting stats
- training history
- injuries/limitations
- dietary preference
- motivation style
- accountability preference

### Plan engine

Stores:

- training plan blocks
- progression rules
- deload/recovery logic
- nutrition targets
- adherence adjustments

### Check-ins

Stores:

- weight and measurements
- subjective energy/hunger/recovery
- progress photos
- weekly review summaries

### Health/activity data

Stores:

- steps
- sleep
- heart rate signals where available
- workout completion history
- imported wearable summaries

### AI coaching layer

Responsible for:

- chat guidance
- summary generation
- pattern detection
- recommendation generation
- escalation boundaries

## 5. AI agent flow

The AI coach should operate in modes, not as one flat chatbot.

### Mode 1, onboarding coach

Purpose:

- understand goal
- create starting profile
- establish coaching tone

### Mode 2, daily coach

Purpose:

- answer questions
- guide today's plan
- reinforce consistency
- handle low-friction accountability

### Mode 3, review coach

Purpose:

- interpret weekly trends
- compare plan vs reality
- recommend focused changes

### Mode 4, photo/data analyst

Purpose:

- analyse uploaded images and metrics
- convert raw inputs into coaching observations
- produce plain-English output with confidence-aware caveats

## 6. Recommended first MVP

Keep v1 tight.

### Include

- onboarding
- goal/profile capture
- basic training plan generation
- calorie/protein guidance
- daily chat coaching
- reminders/check-ins
- weekly review summary
- progress photo upload + basic analysis
- simple data ingestion from user-entered metrics

### Exclude for v1

- medical claims
- advanced biometric modelling
- complex trainer dashboards
- heavy wearable integrations
- autonomous habit plans without user review

## 7. Data and infrastructure approach

### Storage

- object storage for photos
- structured database tables for profiles, plans, check-ins, metrics, summaries
- explicit consent and retention controls around health-like data

### Processing

- synchronous path for normal coaching chat
- async jobs for photo comparison, weekly review, reminder generation, and trend summaries

### Integrations

Future only, not day-one:

- Apple Health / HealthKit bridge
- Google Fit / Health Connect bridge
- nutrition import integrations
- wearable data sources

## 8. Safety posture

Non-negotiable:

- this product gives **general coaching guidance**, not diagnosis
- model outputs must be framed as recommendations, not clinical judgement
- symptom/injury/medical-risk prompts should trigger a safer response pattern
- sensitive photo/data handling must be explicit in consent and deletion flow

## 9. Commercial shape

Possible wedge:

- consumer subscription first
- later upsell trainer/client mode
- long term: PT copilot + consumer coach on the same platform, but not in one rushed MVP

## 10. Opinionated recommendation

Best move is to treat this as a **spec-first Reps-adjacent product**, not a side feature request.

That gives you:

- cleaner positioning
- less product confusion
- a safer compliance story
- a better chance of building something people actually stay with

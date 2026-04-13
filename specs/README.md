# Persistence Mobile — Feature Specs

Structured feature specifications following the Kiro approach. Each milestone has:

- **requirements.md** — User stories with acceptance criteria
- **design.md** — Technical architecture and component design
- **tasks.md** — Implementation checklist (tick off as completed)

## Milestones

| #   | Milestone                                                | Status      | Description                                |
| --- | -------------------------------------------------------- | ----------- | ------------------------------------------ |
| 00  | [Guardrails](./00-guardrails/)                           | Not Started | Testing, linting, architecture scaffolding |
| 01  | [Design System](./01-design-system/)                     | Not Started | UI primitives, theme, tokens               |
| 02  | [Auth Flow](./02-auth-flow/)                             | Not Started | Sign in/up, OAuth, session management      |
| 03  | [Exercise Library](./03-exercise-library/)               | Not Started | Browse, search, filter, custom exercises   |
| 04  | [Workout Management](./04-workout-management/)           | Not Started | CRUD workouts, exercises, supersets        |
| 05  | [Active Session](./05-active-session/)                   | Not Started | Live workout tracking, rest timer          |
| 06  | [Progress & Goals](./06-progress-goals/)                 | Not Started | Measurements, records, goal tracking       |
| 07  | [Health Integration](./07-health-integration/)           | Not Started | HealthKit, Health Connect sync             |
| 08  | [Profile & Settings](./08-profile-settings/)             | Not Started | User profile, preferences                  |
| 09  | [Notifications & Social](./09-notifications-social/)     | Not Started | Push notifications, friendships            |
| 10  | [Trainer Features](./10-trainer-features/)               | Not Started | PT client management, assignments          |
| 11  | [Payments & Subscriptions](./11-payments-subscriptions/) | Not Started | Stripe, subscription tiers                 |
| 12  | [Production Readiness](./12-production-readiness/)       | Not Started | EAS build, store assets, perf audit        |

## Dependency Order

```
00-guardrails ─────────┐
01-design-system ──────┤
02-auth-flow ──────────┤─→ 03-exercise-library ─→ 04-workout-management ─→ 05-active-session
                       │
                       ├─→ 06-progress-goals
                       ├─→ 08-profile-settings
                       │
                       ├─→ 07-health-integration (after 06)
                       ├─→ 09-notifications-social (after 05)
                       ├─→ 10-trainer-features (after 04)
                       ├─→ 11-payments-subscriptions (after 08)
                       └─→ 12-production-readiness (after all)
```

## Agent Guidance

See [\_agent.md](./_agent.md) for architectural constraints, quality gates, and patterns that must be followed for every feature implementation.

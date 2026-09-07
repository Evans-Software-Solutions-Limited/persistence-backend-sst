# Requirements

## Goal

Create an AI health, fitness, and nutrition coach that helps users stay on track, gives practical plan guidance, analyses uploaded progress photos, and turns health/activity data into useful coaching recommendations.

## Product principles

- coach, do not diagnose
- proactive, but not annoying
- useful in daily life, not just during workouts
- simple enough for mainstream users
- trainer-friendly later, but consumer-first initially

## Requirement 1, onboarding and goal setup

**User Story:** As a user, I want the AI coach to understand my goals, constraints, and starting point, so the advice feels relevant from day one.

### Acceptance Criteria

- GIVEN a new user, WHEN they start onboarding, THEN the product captures goal type, training experience, schedule constraints, injuries/limitations, dietary preference, and motivation style.
- GIVEN onboarding is complete, WHEN the user enters chat, THEN the AI coach has a structured profile summary to work from.
- GIVEN the user has unclear goals, WHEN the AI coach asks follow-up questions, THEN it narrows them into a concrete 8 to 12 week target.

## Requirement 2, training plan guidance

**User Story:** As a user, I want the AI coach to help me follow a sensible training plan, so I know what to do next and why.

### Acceptance Criteria

- GIVEN a user profile and goal, WHEN a plan is created, THEN it includes weekly structure, session intent, progression logic, and recovery guidance.
- GIVEN the user misses sessions, WHEN the AI coach updates the plan, THEN it adjusts realistically instead of pretending the missed work happened.
- GIVEN the user completes sessions, WHEN progress is reviewed, THEN the AI coach can suggest next-step changes with a short explanation.

## Requirement 3, nutrition support

**User Story:** As a user, I want help with calories, protein, meal structure, and adherence, so nutrition feels practical rather than overwhelming.

### Acceptance Criteria

- GIVEN a user goal, WHEN nutrition guidance is generated, THEN it includes calorie direction, protein target, and simple meal structure guidance.
- GIVEN the user struggles with adherence, WHEN they ask for help, THEN the AI coach offers simpler fallback options instead of idealised plans.
- GIVEN the user logs enough data, WHEN weekly review runs, THEN the AI coach can flag likely causes of underperformance such as low protein, low consistency, or overeating weekends.

## Requirement 4, accountability and staying on target

**User Story:** As a user, I want the AI coach to keep me on track, so I maintain momentum over time.

### Acceptance Criteria

- GIVEN a user chooses their preferred accountability style, WHEN reminders and check-ins are sent, THEN they match that tone and frequency.
- GIVEN the user is drifting, WHEN recent behaviour shows missed training or poor logging, THEN the AI coach triggers a recovery check-in.
- GIVEN the user is doing well, WHEN milestones are reached, THEN the AI coach reinforces progress and suggests the next focus.

## Requirement 5, photo analysis

**User Story:** As a user, I want the AI coach to analyse uploaded progress photos, so I can get practical visual feedback over time.

### Acceptance Criteria

- GIVEN a user uploads progress photos, WHEN analysis runs, THEN the product stores them against a dated check-in and compares against prior entries.
- GIVEN photo analysis is returned, WHEN feedback is shown, THEN it stays observational and coaching-oriented, not medical.
- GIVEN photo quality is poor, WHEN analysis confidence is low, THEN the product asks for a better photo rather than over-claiming.

## Requirement 6, health and activity data interpretation

**User Story:** As a user, I want the AI coach to use wearable and health data where available, so recommendations reflect what is actually happening.

### Acceptance Criteria

- GIVEN step, weight, sleep, HR, or workout data is available, WHEN the AI coach reviews it, THEN it can summarise trends and suggest practical next actions.
- GIVEN data is incomplete or noisy, WHEN the AI coach responds, THEN it states uncertainty plainly and avoids false precision.
- GIVEN the product lacks enough data, WHEN a recommendation is made, THEN it defaults to conservative coaching advice.

## Requirement 7, safety and compliance boundaries

**User Story:** As the product owner, I want the coach to stay inside safe wellness boundaries, so the product remains commercially viable and lower risk.

### Acceptance Criteria

- GIVEN a user describes symptoms, injury, or medical concerns, WHEN the AI coach responds, THEN it avoids diagnosis and signposts professional help where appropriate.
- GIVEN a recommendation touches health risk, WHEN confidence is limited, THEN the response uses cautionary language and avoids hard claims.
- GIVEN photo or health data is processed, WHEN it is stored and used, THEN consent, retention, and deletion controls are explicit.

## Requirement 8, trainer-ready future path

**User Story:** As the product owner, I want a clean path to trainer features later, so the consumer product can expand without a rewrite.

### Acceptance Criteria

- GIVEN the first MVP ships consumer-first, WHEN trainer features are later added, THEN the underlying data model supports coach/client relationships.
- GIVEN trainer mode is introduced, WHEN a trainer views client state, THEN the system can surface summaries, risk flags, and suggested interventions.
- GIVEN the trainer path is not yet enabled, WHEN consumer flows run, THEN no trainer complexity leaks into the MVP experience.

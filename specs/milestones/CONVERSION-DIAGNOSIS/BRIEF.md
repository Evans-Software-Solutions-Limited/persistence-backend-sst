# Conversion diagnosis — execution overview

Status: ready for scoped implementation; live source evidence is outstanding. Owner: Brad. Scope approval: 17 September 2026. No feature implementation is included in the specification PR.

## Outcome

Explain what can and cannot be learned between a campaign view, app use and a founding purchase. Brad reports roughly 1,500 TikTok views and zero offers taken. This establishes an outcome, not the point of abandonment. User lists alone cannot show anonymous losses.

Authority: [requirements AC5.1–AC5.8](../../30-growth-instrumentation/requirements.md), [design D5.1–D5.5](../../30-growth-instrumentation/design.md), [tasks T5.1–T5.7](../../30-growth-instrumentation/tasks.md). D5.5 selects the first implementation contract. Existing WS1–WS4 backlog is not part of this assignment.

## Work and completion

1. [Backend](BACKEND_BRIEF.md): source inventory and read-only aggregation.
2. [Web admin](FRONTEND_BRIEF.md): honest counts, coverage and missing-data presentation.
3. [Smoke evidence](SMOKE_TEST.md): edge cases plus an authorized real journey.
4. [Meta research and creative](../MARKETING-PLANS/META_EXECUTION_BRIEF.md): tool audit and reviewable experiment package.

Backend and web can proceed against D5.5 concurrently. Live account access is needed only for source verification, not fixture-driven implementation. Missing campaign destination/date prevents a campaign-specific conclusion, not delivery of truthful unknown states. Backend/web work needs no mobile binary. New native instrumentation remains outside this brief.

Done means evidence-backed counts and explicitly unknown gaps, not a claimed conversion uplift. Do not change spend, publish campaigns, contact creators, add advertising events, or alter offers under this brief.

# Conversion diagnosis — web admin agent

## Assignment and ownership

Implement spec 30 AC5.1–AC5.3,AC5.6–AC5.7 / D5.2,D5.5 / T5.5,T5.6. Read the [overview](BRIEF.md). Own web admin page/container, API adapter and UI tests. Coordinate D5.5 contract fixtures with backend; no backend schema ownership, mobile SDK or public landing-page changes.

## Required experience

Extend the existing marketing plan view with app and founding journeys and an explicit date window. Every count shows unit, source, coverage and freshness. Render zero as zero and unavailable as unknown with its reason. Keep manual totals with their real observation interval. Label all-source registration honestly even when a channel is selected. The journey is a sequence of milestones, not an area chart implying invented proportions.

Show a transition rate only when returned as a valid matched cohort, including denominator, numerator and outcome cutoff. Never calculate conversions by dividing unrelated stage totals. The diagnostic summary may identify a measured loss only from valid linked evidence; otherwise state the next missing measurement. Do not confidently diagnose weak creative from views and zero purchases alone.

Handle loading, empty, partial-source failure, unauthorized, retry and complete states using existing admin patterns. Preserve existing plan/contribution reporting. Fixture data must be clearly synthetic and never silently substitute for an API failure in production. Use accessible tab/filter controls and readable narrow layouts.

## Validation and handoff

Test unknown versus zero, manual period mismatch, unsupported channel attribution, null rate and zero denominator, non-linear purchase timing, date boundaries and request error handling. Verify rendered UI with screenshots according to visual-verify. Integrate the real backend response before declaring complete. Return acceptance mapping, screenshots, checks, residual source gaps and exact task updates. No public campaign publishing, offer edits or native build.

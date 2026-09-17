# Coach discovery — execution brief

17 September 2026. Spec publication authorized; no implementation or build claimed complete.

## Spec alignment

[Requirements](../../35-coach-discovery/requirements.md) AC1–11, [design](../../35-coach-discovery/design.md) D1–6 (D5–6 supersede draft options), [tasks](../../35-coach-discovery/tasks.md) T2–8.

Deliver the complete opt-in directory, local/online search, independent availability, safe enquiries and consented connection. Authenticated free/paid athletes browse; eligible coach subscriptions include listing. Working defaults are documented in the parent spec. Payments, reviews, booking and sponsored ranking are excluded.

## Agent ownership

- [Backend agent](BACKEND_BRIEF.md): persistence, APIs, eligibility/privacy and relationship integration.
- [Mobile agent](FRONTEND_BRIEF.md): ports/adapters, coach profile and athlete journey.
- Integration owner coordinates shared schema/API mounts with Train Together, then runs [smoke](SMOKE_TEST.md).

Parallel work uses the exact D5 fixtures. Train Together owns places, social safety and the location adapter. Merge dependent implementation only after integrated smoke; do not replace that gate with mocked results. Provider provisioning, real-device/native binary verification and a recruited coach pilot are genuine external gates; report them explicitly. No build, outreach or purchase is authorized by this brief.

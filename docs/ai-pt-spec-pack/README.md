# AI PT Product Spec Pack

Working title: **Reps Coach**

This pack uses a Kiro-style spec-driven structure, adapted for Bradley's workflow and the SST monorepo template.

## Included files

- [`requirements.md`](./requirements.md) — user stories and acceptance criteria
- [`design.md`](./design.md) — product, architecture, data, and agent design
- [`tasks.md`](./tasks.md) — phased implementation plan
- [`agent-flow.md`](./agent-flow.md) — how the AI coach should behave at runtime
- [`steering/product.md`](./steering/product.md) — market, personas, positioning, compliance boundary
- [`steering/tech.md`](./steering/tech.md) — SST conventions, AI boundaries, and storage rules
- [`steering/structure.md`](./steering/structure.md) — repo/package conventions and spec layout

## Product framing

This should be treated as a **separate product track**, not bolted directly into Persistence.

Reason:

- Persistence is mainly a client + trainer product
- this concept wants a more opinionated, always-on coaching relationship
- it will need different onboarding, memory, compliance boundaries, and monetisation

## Guardrail

This is a **wellness / coaching** product, not a diagnosis or medical advice product.

So:

- guidance, accountability, plans, adherence, progress review = yes
- diagnosis, treatment, medical claims = no

# Persistence SST Planning Docs

This directory holds the current planning docs for getting Persistence to a production-ready state and for rebuilding the mobile app frontend in a cleaner offline-first shape.

## Docs

- [`production-readiness-plan.md`](./production-readiness-plan.md) — what must be true before Persistence can be treated as production-ready on the SST stack
- [`mobile-v2-offline-first-plan.md`](./mobile-v2-offline-first-plan.md) — the rebuilt frontend plan using the existing `persistence-mobile` app as the basis/reference, but reworked for offline-first, performance, and battery efficiency
- [`claude-implementation-brief.md`](./claude-implementation-brief.md) — a practical work order for the implementation lane / Claude agent

## Current Direction

- Keep the database in Supabase
- Keep Supabase Auth for now
- Continue the SST API migration as the system boundary
- Rebuild the mobile frontend as a cleaner V2 instead of endlessly patching the old one
- Prioritise offline-first behaviour, performance, and lower battery usage over preserving the old frontend structure

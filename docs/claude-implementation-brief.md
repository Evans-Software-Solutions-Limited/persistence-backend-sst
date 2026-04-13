# Claude Implementation Brief, Persistence Production + Mobile V2

## Goal

Turn Persistence into a production-ready SST-backed app, while rebuilding the mobile frontend into a cleaner offline-first V2.

## Inputs

- `docs/production-readiness-plan.md`
- `docs/mobile-v2-offline-first-plan.md`
- current backend code in this repo
- current mobile code in the `persistence-mobile` repo
- existing Supabase backend/source-of-truth behaviour

## Outputs

Produce, in order:

1. a gap analysis of current SST backend coverage vs the production-readiness plan
2. a proposed implementation sequence with issue-sized slices
3. the first concrete slice implemented, tested, committed, and pushed
4. an updated doc note if implementation changes any assumptions

## Steps

1. Read the two planning docs in `docs/` first.
2. Audit the current SST backend and identify what already exists versus what the docs say is still needed.
3. Separate work into:
   - backend completion work
   - mobile V2 foundation work
   - integration/cutover work
4. Produce the smallest sensible execution sequence that unlocks the new mobile architecture quickly.
5. Start with the highest-leverage backend slice, unless the repo state proves a different dependency order.
6. Implement only one coherent slice at a time.
7. Run the relevant checks for the slice you changed.
8. Commit, push, and report back with what is done, what is next, and any blockers.

## Guardrails

- Do not rewrite the product aim.
- Do not reintroduce direct mobile business-table access as the long-term pattern.
- Do not treat the old frontend structure as something that must be preserved.
- Keep Supabase as the database for now.
- Keep SST as the API boundary.
- Keep auth/session handling compatible with the current product path unless the docs are explicitly updated.
- Do not take on multiple large slices at once.

## Confirm Points

Stop and report before proceeding if:

- the current repo state materially disagrees with the planning docs
- exercise/Algolia dependencies are blocked in a way that changes ordering
- the proposed mobile V2 boundary cannot be kept clean inside the existing repo structure
- a migration requires a product decision rather than an engineering decision

## Definition of Done

- gap analysis completed
- execution order proposed
- first slice shipped on a branch with checks run
- next slice clearly identified

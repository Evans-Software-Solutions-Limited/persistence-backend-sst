# Persistence Together — execution brief

17 September 2026. This replaces the discussion brief; historical decisions remain in the parent specification. Brad authorized preparation/merge of these briefs. Defaults were selected for execution planning, not individually ratified product choices. The 21 September update authorizes PR #462 to deliver all Together backend work across PER-20, PER-21 and backend PER-22. Mobile and integrated rollout gates remain.

## Spec alignment

Authority: [requirements](../../34-train-together/requirements.md) AC1–14, [design](../../34-train-together/design.md) D8–10 (supersedes draft proposals), [tasks](../../34-train-together/tasks.md) E1–7. Scope: two-person live collaboration, friends, nearby discovery and reusable plans, one release. Competition stays backlog.

## Agent assignments

- [Backend](./BACKEND_BRIEF.md): E1–3 and server evidence for E7.
- [Frontend](./FRONTEND_BRIEF.md): E4–5 and mobile evidence for E7; can begin against contract fixtures while backend proceeds.
- [Research](./RESEARCH_BRIEF.md): E6 and pilot portion of E7. Prepare protocol now; outreach requires Brad's authorization.
- [Review smoke](./SMOKE_TEST.md): integrated two-phone evidence, not mocked synchronization claims.

Backend publishes wire fixtures/ADR before frontend adapter integration. Together owns shared place/social/block/report and mobile location permission/selector contracts consumed by coach discovery. Coordinate shared file ownership before parallel changes. Each implementation PR traces acceptance criteria, design and checked tasks, passes repository checks and local Inspector Brad review. Spec gaps require amendments before code.

## Release gates

Technical spike can proceed independently of recruitment. Customer evidence, transport/provider operational choice, moderation owner and real two-device proof remain outstanding. Do not label hypotheses successful or completed. Brad controls native builds; no agent may start EAS/native/mobile builds without specific authorization. GPS requires a compatible new binary. Product rollout follows one coordinated release, behind flags until all gates pass.

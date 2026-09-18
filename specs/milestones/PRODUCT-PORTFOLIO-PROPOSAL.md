# Persistence — visual product backlog proposal

18 September 2026. Proposed organization, not an external board or a complete implementation audit. Recent code evidence is from main `162ba03a`; the status of every older spec still needs reconciliation against current code, tests, release flags and deployed app versions.

## Recommended tool

**Linear** is the recommended product-facing roadmap: projects and initiatives organize the work, while Linear Agent can create/update work items and summarize workspace context. Its GitHub integration links development progress. Sources: [initiatives](https://linear.app/docs/initiatives), [Linear Agent](https://linear.app/docs/linear-agent), [GitHub integration](https://linear.app/docs/github-integration). These capabilities do not prove feature completeness without evidence supplied from the repository and releases.

**GitHub Projects** is the lowest-friction alternative for keeping the backlog beside existing issues/PRs, with board/table/roadmap views and custom fields. [Projects documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects). GitHub also documents AI-assisted issue planning through Copilot. [Planning tutorial](https://docs.github.com/en/copilot/tutorials/plan-a-project).

**Jira with Rovo** is viable where an existing Jira workspace is preferred; AI can help refine and structure work. [Jira AI](https://www.atlassian.com/software/jira/ai). Keep Persistence in its own project/workspace; do not mix personal product planning with client-company work.

Linear's current published Free plan lists 250 issues, two teams and Linear Agent; paid plans expand capacity and some AI/code capabilities. Check actual workspace availability before choosing a paid plan or bulk-importing the whole repo. [Pricing](https://linear.app/pricing). No subscription, account connection, new project or ticket creation is performed by this proposal.

## Two separate status dimensions

- **Delivery:** Idea → Research/spec → Ready → In progress → Review → Done. Blocked is a dependency/flag with a named reason, not a dumping ground.
- **Evidence/release:** Unverified / Spec only / Partial code / Implemented and tested / Merged / Staging verified / Released to users. Record platform/build and date. Do not automatically promote a whole feature to released because one PR merged.

Each work item carries feature/spec ID, plain-language outcome, backend/web/mobile/platform scope, remaining acceptance criteria, dependency IDs, owner, proposed priority, effort range with confidence, evidence links (spec/code/test/PR/release), and last verification commit/date. Keep estimates unknown until the responsible agent has scoped the work; no invented completion percentages.

Use an initiative for a customer outcome, a project for a feature, and issues/sub-issues for independently testable work. Keep the repository requirements/design/tasks authoritative for implementation contracts; the board owns priority, assignment and delivery state. Link rather than duplicate long specs.

## Seed projects from recent sessions

The entries below are a starting map, not tickets already created. Priorities are proposals.

| ID     | Project/outcome                                               | Current evidence                                                                   | Main next work/dependency                                                                                                                      |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| FND-01 | Faithful schedules and prescriptions                          | Existing flat-cycle scheduler; extension is scoped                                 | Explicit dates, week-specific prescription revisions, populated migration and old-client compatibility. Blocks full-fidelity multiweek import. |
| IMP-01 | Bring a workout/programme from photo, PDF, URL, text or voice | Spec 22 amended; no mounted programme import in audited main                       | Per-source accuracy/cost eval, private draft/jobs, exercise resolution, atomic accept; FND-01 for explicit programmes.                         |
| VOI-01 | Discuss and design a programme                                | Spec 22 GD scope only                                                              | Explicit generation intent, coaching-method profile and constraint evaluation; reuse import draft/accept.                                      |
| WEB-01 | Coach and Premium Plus web planning                           | Backend/mobile coach authoring exists; web workspace absent in audit               | Non-admin web shell, owner/self capabilities, editor and imports; FND-01 for richer planning.                                                  |
| REV-01 | Athlete and coach share understandable progress               | Existing private coach review and separate athlete stats; shared projection scoped | Common adherence definition, safe shared DTO/AI, comments and self view. No coach-private data leakage.                                        |
| EXI-01 | Move an existing exercise library into Persistence            | Individual exercise CRUD/search exists; bulk import scoped                         | CSV/XLSX mapping, duplicate decisions, owner aliases and resumable receipts.                                                                   |
| SOC-01 | Persistence Together                                          | Specs/briefs merged in PR #455; feature implementation not established             | Research/pilot, authorized live sync, per-person results, friendship/nearby/reuse.                                                             |
| COA-01 | Find local/online coaches                                     | Specs/briefs merged in PR #455; directory implementation not established           | Opt-in listings/search/enquiries; shared places/safety and existing consent/seat flow.                                                         |
| GRO-01 | Locate conversion drop-off                                    | Existing admin counts/manual totals; diagnostic extension scoped                   | Truthful source/coverage/cohort reporting and actual destination evidence.                                                                     |
| MKT-01 | Meta AI/creator experiments                                   | Research and execution brief merged; campaign results not claimed                  | Tool/offer audit and draft creative; GRO-01 informs measured experiments. Spend/publication remain separate.                                   |

References: [social/growth handoff](SOCIAL-GROWTH-HANDOFF.md), [new workspace/import handoff](COACHING-WORKSPACE-IMPORT/BRIEF.md), [full spec index](../README.md).

## Views Brad should have

1. **Product map:** grouped by athlete experience, coach tools, social, growth and foundations; show current evidence and next outcome.
2. **Ready next:** only work with enough specification and satisfied dependencies to start.
3. **What is blocking this?:** prerequisite links, owner and next decision/evidence needed; FND-01 leads to explicit programme import and advanced editors.
4. **Built but not released:** merged work still waiting for configuration, QA, app build or rollout.
5. **Needs a decision:** subscription/product choices, evaluation thresholds or external access; no ordinary coding tasks hidden here.

## Populate reliably

Inventory every spec/milestone, normalize duplicate names, then check its acceptance criteria against mounted handlers, UI entry points, tests, feature flags and release evidence. Label uncertain claims Unverified. Reconcile existing GitHub issues before creating anything to avoid duplicate work. Import a small reviewed set first, including FND-01, then expand to older features.

AI can prepare issues, dependency summaries and suggested status changes with evidence. PR linking can update engineering progress, but release verification remains distinct. A future scheduled reconciliation is optional and requires its own explicit setup; no automation is created here. A connected Linear account/project choice is needed before creating an external backlog.

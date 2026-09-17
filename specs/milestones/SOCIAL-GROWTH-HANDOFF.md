# Social and growth — agent handoff

Prepared 17 September 2026. This is a specification package; features, interviews, pilots and advertising experiments are not completed. Start subsequent implementation from current main in isolated branches.

## Dispatch briefs

Use the linked brief as the full assignment. Each requires reading its parent requirements/design/tasks and returning acceptance evidence rather than marking work complete from code alone.

| Agent track               | Brief                                                                                                                                                | Can start / dependencies                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Together product research | [Research](TRAIN-TOGETHER/RESEARCH_BRIEF.md)                                                                                                         | Protocol/prototype now; authorized recruitment before real interviews                             |
| Together backend          | [Backend](TRAIN-TOGETHER/BACKEND_BRIEF.md)                                                                                                           | Transport ADR and shared contract first; owns shared social safety and places services            |
| Together mobile           | [Frontend](TRAIN-TOGETHER/FRONTEND_BRIEF.md)                                                                                                         | Pure models/fixtures now; integrate backend and shared location adapter before completion         |
| Coach backend             | [Backend](COACH-DISCOVERY/BACKEND_BRIEF.md)                                                                                                          | Directory domain now; consume Together place/block/report contract; coordinate migration ordering |
| Coach mobile              | [Frontend](COACH-DISCOVERY/FRONTEND_BRIEF.md)                                                                                                        | UI/fixtures now; consume Together-owned location selector and existing consent flow               |
| Conversion backend        | [Backend](CONVERSION-DIAGNOSIS/BACKEND_BRIEF.md)                                                                                                     | Existing-source inventory and D5.5 report implementation now                                      |
| Conversion web admin      | [Frontend](CONVERSION-DIAGNOSIS/FRONTEND_BRIEF.md)                                                                                                   | D5.5 fixtures now; integrate real report and verify screenshots                                   |
| Meta research/creative    | [Execution](MARKETING-PLANS/META_EXECUTION_BRIEF.md)                                                                                                 | Research and reviewable drafts now; account access/publication/spend are separate                 |
| Integration and release   | [Together smoke](TRAIN-TOGETHER/SMOKE_TEST.md), [coach smoke](COACH-DISCOVERY/SMOKE_TEST.md), [conversion smoke](CONVERSION-DIAGNOSIS/SMOKE_TEST.md) | Prepare scenarios now; run after integrated implementations exist                                 |

Copyable assignment (substitute one brief path):

> Implement the work in `<brief path>` from current main. Read its linked requirements, design and tasks first; they are the source of truth. Own only the modules assigned by the brief and coordinate shared contracts with other agents. Preserve unrelated edits. Update acceptance/task evidence as it is earned. Run affected checks and the required local Inspector review before a PR. Return changed behavior, validation, dependencies and remaining release gates. Do not initiate native/EAS builds, publish ads, spend money, contact research participants/creators or deploy paid services under this assignment. Prepare any gated action for Brad to review after completing independent work.

For the research/creative track, substitute “Produce the deliverables” for “Implement the work.” No new tasks are automatically dispatched by this handoff.

## Product choices carried into execution

**Persistence Together** is a working name, not trademark clearance. Selected implementation defaults are two participants, personal results, explicit revocable partner logging, independent rest/substitutions and paid eligibility for live/reusable collaboration. Free authenticated users may browse/discover where specified. Friends, optional nearby discovery and reusable sharing belong to the coordinated Together release. Competition remains a separate scored-design backlog, not a fabricated leaderboard in this release. Research can change defaults when evidence warrants it; these are documented planning choices rather than individually confirmed answers from Brad.

Coach discovery is opt-in and included in eligible coach subscriptions, with independent visibility/availability controls and free authenticated athlete browsing. Enquiry acceptance never grants health access. Fresh athlete consent and the existing relationship/coach seat checks remain required. New client-origin requests await coach acceptance; an existing coach invitation follows the athlete-acceptance route and can activate immediately after consent and seat validation.

The immediate growth deliverable is honest measurement: unknown is not zero, and views are not proof of a joined conversion journey. The detailed [Meta AI tools document](MARKETING-PLANS/META-AI-AND-CREATOR-TOOLS.md) includes the webinar and subsequent official feature announcements; the execution brief turns it into research, assets and an experiment proposal.

## Shared ownership and integration order

Together backend owns common places, blocks/reports and interaction checks. Together mobile owns the shared location permission/search adapter. Coach consumes them. Backend owners agree contract changes before dependent code; one integration owner orders schema migrations and shared exports. Mobile owners coordinate navigation and shared components rather than overwriting each other. Growth owns existing admin reporting, not social tables. Only the integration owner updates cross-track completion status after all evidence is available.

Prefer small internal implementation PRs behind disabled flags while keeping the agreed customer release coherent. Backend deploys must remain compatible with older clients. Realtime transport selection/proof is the first technical gate: private authorization, reconnect, durable recovery and per-user idempotent finalization matter more than a fast demo. See Together D8–D10 for concrete state and API contracts.

## Release/build gates

WebSocket synchronization itself need not add a native module. Foreground GPS support with a new native location module/config requires Brad to build and distribute compatible iOS/Android binaries; these briefs do not authorize anyone else to start them. Manual place selection remains available when location permission is declined. Provider credentials/provisioning, real two-phone/offline evidence, moderation ownership and the documented pilot criteria gate public Together release. Coach needs consent/seat/block races proved end to end. Reporting needs real receipt evidence before claiming operational attribution.

Preparation/reversible implementation is authorized by dispatching a brief. Separate authorization applies to external recruiting, campaign spend/publication, paid provisioning and owner-only native builds. Do not turn a future release gate into a reason to stop independent implementation.

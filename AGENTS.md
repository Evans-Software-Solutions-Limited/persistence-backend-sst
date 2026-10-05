# Persistence agent workflow

These instructions travel with the repository. New-machine setup is documented
in [docs/agent-setup.md](docs/agent-setup.md); no particular checkout path or
private home-directory memory is required for this workflow.

## Start with the live work item

For Persistence product, design or implementation work, read the assigned Linear
issue and its latest handoff before choosing a slice. When choosing what is next
or working on the upcoming release, also read
[PER-75](https://linear.app/evans-software-solutions/issue/PER-75) and its linked
[product decision record](https://linear.app/evans-software-solutions/document/next-release-and-product-direction-nutrition-core-coaching-and-e0476fe3d5c0).
Follow an explicitly linked successor if these records are superseded. Do not
copy a dated implementation queue into agent instructions.

- Brad's current instructions take precedence. Linear owns agreed product scope,
  priorities, dependencies, design handoffs and the next action. An idea or
  research ticket is not approval to implement or ship it.
- Repository specs/briefs own technical contracts; `STATE.md`, git/PRs and test
  evidence establish implementation state. A stale Linear checklist must not
  cause completed code to be rebuilt; a local ledger must not override a newer
  product decision. Reconcile discrepancies and update the affected record.
- Read applicable engineering guidance in `CLAUDE.md` and `specs/_agent.md` for
  code work. Their technical rules remain in force; this workflow supersedes
  older claims that repository ledgers alone determine product priorities.

## Keep startup and execution small

1. Fetch the named issue directly; read only linked dependencies/designs relevant
   to this slice. Search Linear only if no issue is supplied. Reuse an existing
   issue rather than creating duplicates. Do not inventory the whole backlog.
2. Check `git status`, current branch/PR and the recent relevant `STATE.md` entry.
   Preserve concurrent/uncommitted work. Read older history only to resolve a
   specific question; never assume an older snapshot is today's remaining work.
3. State the issue, bounded next action and any real dependency briefly. Continue
   already-authorised work without repeatedly asking Brad to confirm decisions.
4. Respect design handoffs: if a ticket first requires a Claude-ready brief,
   deliver the complete linked brief to Brad before implementing its new UI.
   Use returned, reviewed designs as the implementation reference.
5. Load only relevant skills/files and run checks appropriate to the change.
   Delegate only substantial independent tracks under the applicable routing
   rules; give a subagent the issue, acceptance criteria, file ownership and
   relevant evidence so it need not rediscover the project. Do not mandate
   parallel agents or multiple PRs for a small task.

If Linear is unavailable, report that once. Continue a clearly authorised slice
from available context, noting its freshness; do not invent current priorities,
claim synchronisation or autonomously select the next release feature. Preserve
the pending Linear update in the handoff until access returns.

## Leave one useful handoff

At a meaningful milestone or session end, update the existing Linear issue with
the outcome, artifact/PR/design links, validation actually run, remaining gaps
and one concrete next action. Distinguish implemented, tested, merged, deployed
and released. Mark Done only when the issue's own acceptance is met. Keep the
current handoff prominent and dated; avoid accumulating contradictory “next”
sections or routine progress comments. Preserve prior evidence/history.

For code changes, add a concise technical entry to `STATE.md` with the Linear
issue link; do not duplicate the product backlog there. Refresh the live issue
before a new phase or handoff, not before every command. A useful handoff is:
`Issue | Outcome + links | Verified / unverified | Remaining | Next action`.

## Builds and publication

Brad builds the app himself after merging. Never start a native, prebuild, EAS
or mobile build unless he explicitly authorises that specific build. A ticket
mentioning a future build/release is not authorisation. Likewise, planning a
campaign or social post does not authorise sending/publishing it.

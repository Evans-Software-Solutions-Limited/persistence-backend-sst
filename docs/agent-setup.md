# Agent setup on a new machine

## Durable sources

- Clone `git@github.com:Evans-Software-Solutions-Limited/persistence-backend-sst.git`
  into any directory. Open the repository root as the agent project.
- Use a branch containing the merged agent-workflow instructions. `AGENTS.md`
  is the shared startup contract; `CLAUDE.md` links Claude to it. Agents launched
  elsewhere must be explicitly pointed at the repository instructions.
- Linear holds product decisions, issue acceptance, sequencing and handoffs.
  Repository specs, `STATE.md` and PRs hold technical contracts and evidence.
  Chat history, an old laptop's planning folder and personal memory files are
  not prerequisites for picking up work.

## Access and tools

1. Sign into GitHub with access to the private repository and Linear with access
   to the Evans Software Solutions workspace / Persistence team. Connect Linear
   in each agent application/account that will use it; a clone does not transfer
   connector authentication. Verify read access and authorised issue updates.
2. Install the repository's pinned runtime/package tooling using its README and
   package manifests. Follow the relevant technical setup only when required by
   the task. Product/design brief work does not require cloud deployment access.
3. Configure credentials through the documented secret manager or environment
   setup. Never copy credentials, tokens or secret-bearing home-directory state
   into Git, Linear or this guide.
4. Personal skills, plugins and notification integrations are separate setup.
   If a referenced skill is absent, report the specific limitation; do not claim
   it ran. Read-only planning can continue where that skill is not required.
   Code/PR work must still satisfy its applicable quality/review gates.

## First-session smoke check

Ask the agent to identify its loaded project instructions, read the assigned
Linear issue and PER-75 when choosing release work, and state the next action
with its evidence source. Confirm it distinguishes current product direction
from old technical snapshots and knows that Brad owns native builds.
This is a read-only check: no code edits, status changes or messages are needed.

## Keeping machines aligned

Commit and review instruction changes with the repository; merge before treating
them as the default for new clones. Existing checkouts/worktrees must incorporate
that commit without discarding their local work. Running agents should reread
the instructions at the next handoff; a Git update does not retroactively inject
context into every active session. Keep changing priorities in Linear rather
than maintaining machine-specific copies of the queue.

/**
 * Page sizes for the scheduler's batch reads (PER-117). Every job pages
 * through ALL its rows within a run, a page at a time, so nothing past a cap
 * is skipped (Inspector Brad, #548). Mutable only so tests can use tiny pages.
 */
export const PAGE_SIZES = {
  /** Active weekly/daily rules per read. */
  formRules: 500,
  /** Coaches who track training, per read. */
  behindTrainers: 200,
  /** Coaches with held pushes, per read. */
  heldTrainers: 500,
  /** Expired invites not yet announced, per read. */
  expiredInvites: 500,
  /** Programmes ending soon not yet announced, per read. */
  endingProgrammes: 500,
};

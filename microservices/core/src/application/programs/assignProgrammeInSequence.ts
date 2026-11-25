import type { DbOrTx } from "../repositories/personalRecordsRepository";
import {
  ProgramAssignmentRepository,
  type AssignProgramResult,
} from "../repositories/programAssignmentRepository";

/**
 * The one way new programme assignments are made without dates (PER-112,
 * design G part 2): coach Assign with no start date, the design A set-up on
 * accept, and "Me" (`POST /users/me/program-assignments`).
 *
 * The assignment is `schedule_mode = 'sequence'`. `start_date` holds the
 * assignment date (so the NOT NULL column and old readers stay valid), there's
 * no end date, and every workout is created once with no due date and its
 * `sequence_index`. Next is the lowest one not yet completed.
 *
 * Authorization is the caller's job (relationship, role); programme ownership
 * is checked by the repository.
 */
export async function assignProgrammeInSequence(params: {
  /** Who assigns: the coach, or the athlete themselves for "Me". */
  assignerId: string;
  clientId: string;
  programId: string;
  /** YYYY-MM-DD, the assignment date. */
  today: string;
  showInPlan?: boolean;
  showInLibrary?: boolean;
  /** "Me" may use a public programme as well as the caller's own. */
  allowPublicProgram?: boolean;
  /** Run inside this transaction (the set-up accept). */
  tx?: DbOrTx;
  repository?: ProgramAssignmentRepository;
}): Promise<AssignProgramResult> {
  const repository = params.repository ?? new ProgramAssignmentRepository();
  return repository.assign(
    params.assignerId,
    params.programId,
    {
      clientId: params.clientId,
      scheduleMode: "sequence",
      showInPlan: params.showInPlan,
      showInLibrary: params.showInLibrary,
      allowPublicProgram: params.allowPublicProgram,
    },
    params.today,
    params.tx,
  );
}

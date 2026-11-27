import type { SchedulerJob } from "../coachScheduler";
import { reconcileChatChannels } from "../../../chat/chatChannels";

/**
 * PER-120 (design E): Stream chat channel retries. Provisions channels whose
 * relationship is active but which are `pending` (or missing, or still frozen
 * from an earlier coaching cycle), and freezes channels whose relationship
 * has ended. A no-op while chat is not configured. Writes no coach events.
 *
 * Time-bounded (90 s from the tick start, stop after 2 Stream failures), so
 * a hanging Stream can't use up the Lambda before `sessionRemindersJob`,
 * which runs after it (Inspector Brad, #570).
 */
export const chatChannelsJob: SchedulerJob = {
  name: "chat_channels",
  cadence: "tick",
  async run(ctx) {
    return { ...(await reconcileChatChannels(ctx.now)) };
  },
};

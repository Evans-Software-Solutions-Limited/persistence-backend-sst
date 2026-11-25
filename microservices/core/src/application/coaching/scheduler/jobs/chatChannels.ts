import type { SchedulerJob } from "../coachScheduler";
import { reconcileChatChannels } from "../../../chat/chatChannels";

/**
 * PER-120 (design E): Stream chat channel retries. Provisions channels whose
 * relationship is active but which are `pending` (or missing, or still frozen
 * from an earlier coaching cycle), and freezes channels whose relationship
 * has ended. A no-op while chat is not configured. Writes no coach events.
 */
export const chatChannelsJob: SchedulerJob = {
  name: "chat_channels",
  cadence: "tick",
  async run(ctx) {
    return { ...(await reconcileChatChannels(ctx.now)) };
  },
};

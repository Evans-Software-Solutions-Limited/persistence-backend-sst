import { CoachYouContainer } from "@/ui/containers/CoachYouContainer";
import { YouContainer } from "@/ui/containers/YouContainer";
import { useUserMode } from "@/state/user-mode";

/**
 * You tab — branches on `useUserMode().mode` (mirrors index.tsx).
 *
 * Athletes get the Progress/identity surface (`YouContainer`, owned by
 * 06-progress-goals). Coaches get the Coach You dashboard (`CoachYouContainer`,
 * 10-trainer-features) — "Your practice" with business stats, client health,
 * the coach's own training peek, programmes, recent activity, and the invite
 * affordance.
 *
 * Spec: specs/14-navigation/design.md § Route migration table (you.tsx)
 *       specs/10-trainer-features/requirements.md STORY-012
 */
export default function YouTab() {
  const mode = useUserMode((s) => s.mode);
  return mode === "coach" ? <CoachYouContainer /> : <YouContainer />;
}

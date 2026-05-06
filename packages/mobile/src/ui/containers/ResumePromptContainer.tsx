/**
 * ResumePromptContainer — glues `useResumeSession` to the
 * `<ResumePrompt>` overlay. Mounted in `(app)/_layout.tsx`. (M3.)
 *
 * Continue → routes to `/(app)/session?sessionId=…` and dismisses.
 * Discard → fires `cancelSessionCommand` (which queues a recordSession
 * cancellation flush) then dismisses.
 *
 * Spec: specs/05-active-session/requirements.md STORY-008
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 9
 */

import { router } from "expo-router";
import { useCallback } from "react";
import { cancelSessionCommand } from "@/application/commands/session";
import { ResumePrompt } from "@/ui/components/session/ResumePrompt";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useResumeSession } from "@/ui/hooks/useResumeSession";

export function ResumePromptContainer() {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;
  const resume = useResumeSession();

  const onContinue = useCallback(() => {
    if (!resume.session) return;
    const sessionId = resume.session.id;
    resume.dismiss();
    router.push(`/(app)/session?sessionId=${sessionId}` as never);
  }, [resume]);

  const onDiscard = useCallback(() => {
    if (!userId) {
      resume.dismiss();
      return;
    }
    cancelSessionCommand({ storage, userId });
    resume.dismiss();
  }, [userId, storage, resume]);

  return (
    <ResumePrompt
      session={resume.session}
      onContinue={onContinue}
      onDiscard={onDiscard}
      onDismiss={resume.dismiss}
    />
  );
}

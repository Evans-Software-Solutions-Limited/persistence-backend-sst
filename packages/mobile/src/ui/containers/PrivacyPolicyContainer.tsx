import { useRouter } from "expo-router";
import { useCallback } from "react";
import { PrivacyPolicyPresenter } from "@/ui/presenters/PrivacyPolicyPresenter";

/**
 * M12: Privacy Policy route container. Static legal screen — only job
 * is wiring the back arrow to `router.back()`.
 */
export function PrivacyPolicyContainer() {
  const router = useRouter();
  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  return <PrivacyPolicyPresenter onBack={onBack} />;
}

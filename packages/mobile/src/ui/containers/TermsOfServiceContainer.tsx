import { useRouter } from "expo-router";
import { useCallback } from "react";
import { TermsOfServicePresenter } from "@/ui/presenters/TermsOfServicePresenter";

/**
 * M12: Terms of Service route container. Static legal screen — only
 * job is wiring the back arrow to `router.back()`.
 */
export function TermsOfServiceContainer() {
  const router = useRouter();
  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  return <TermsOfServicePresenter onBack={onBack} />;
}

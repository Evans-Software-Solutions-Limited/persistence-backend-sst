import { useRouter } from "expo-router";
import { useCallback } from "react";
import { HelpCenterPresenter } from "@/ui/presenters/HelpCenterPresenter";

/**
 * M12: Help Center route container. Wires the back arrow and the
 * Contact Support CTA into expo-router. The CTA pushes the contact
 * route the ProfileContainer also targets (`/(app)/profile/contact`),
 * so deep-links remain consistent.
 */
export function HelpCenterContainer() {
  const router = useRouter();
  const onBack = useCallback(() => {
    router.back();
  }, [router]);
  const onContactSupport = useCallback(() => {
    router.push("/(app)/profile/contact" as never);
  }, [router]);

  return (
    <HelpCenterPresenter onBack={onBack} onContactSupport={onContactSupport} />
  );
}

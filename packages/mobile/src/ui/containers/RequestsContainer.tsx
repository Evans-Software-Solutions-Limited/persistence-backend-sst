import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import { RequestsPresenter } from "@/ui/presenters/RequestsPresenter";

/**
 * <RequestsContainer> — wires `useClientRelationships("pending")` into
 * <RequestsPresenter>. Accept/decline call through to
 * POST /clients/me/relationships/:id/respond; the hook removes the row on
 * success. Reached via the notification deeplink → /(app)/requests.
 */
export function RequestsContainer() {
  const router = useRouter();
  const { data, isLoading, isRefreshing, error, refresh, respond, pendingIds } =
    useClientRelationships("pending");

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/you");
  }, [router]);

  const onAccept = useCallback(
    (id: string) => {
      void respond(id, "accept");
    },
    [respond],
  );
  const onDecline = useCallback(
    (id: string) => {
      void respond(id, "decline");
    },
    [respond],
  );

  return (
    <RequestsPresenter
      requests={data}
      pendingIds={pendingIds}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      error={error}
      onRefresh={refresh}
      onBack={onBack}
      onAccept={onAccept}
      onDecline={onDecline}
    />
  );
}

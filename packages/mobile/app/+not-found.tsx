import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Expo Router's file-based-routing convention: this route renders whenever
 * a navigation target doesn't match any registered screen (typo'd
 * `router.push` path, stale deep link, etc.). Added as a go-live safety net
 * after a dead `router.push("/(app)/subscription-management")` call (a
 * route that was never registered) silently no-op'd instead of surfacing
 * anything to the user — see WorkoutsListContainer's `onUpgrade`.
 *
 * Reuses the existing <ComingSoon> placeholder scaffolding rather than a
 * bespoke layout — same tokens/spacing as every other "nothing here yet"
 * screen in the app.
 */
export default function NotFoundScreen() {
  return (
    <ComingSoon
      icon="alert-circle-outline"
      title="Screen not found"
      description="We couldn't find the screen you were looking for."
      safeAreaTop
      testID="not-found"
    />
  );
}

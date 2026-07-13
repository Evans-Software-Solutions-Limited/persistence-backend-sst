import { useCallback } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { RestoreAccountPresenter } from "@/ui/presenters/RestoreAccountPresenter";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useRestoreAccount } from "@/ui/hooks/useRestoreAccount";

/**
 * Container for the `/(app)/restore-account` gate screen (Cluster 2b —
 * account-deletion soft-delete).
 *
 * Reached only when `AuthGate` (app/_layout.tsx) detects the loaded
 * profile-page payload has `deletedAt != null` — a signed-in user whose
 * account is inside its 30-day soft-delete grace period.
 *
 * - Restore -> `POST /account/restore`, then force-refreshes the
 *   profile-page cache (bypassing its TTL) so `AuthGate` re-evaluates on
 *   the next render with `deletedAt: null` and routes into the normal
 *   tabs. A 409 (account wasn't actually soft-deleted — e.g. a race with
 *   another device already restoring it) is treated the same as success:
 *   refresh + proceed, since the end state the user wants is identical.
 * - Sign out -> tears down the session, leaving the deletion pending;
 *   `AuthGate`'s existing `!session` branch routes to sign-in.
 */
export function RestoreAccountContainer() {
  const router = useRouter();
  const { signOut } = useAuth();
  const profilePage = useProfilePage();
  const restoreAccount = useRestoreAccount();

  const purgeAfter = profilePage.payload?.profile.purgeAfter ?? null;

  const onRestore = useCallback(async () => {
    try {
      await restoreAccount.mutateAsync();
    } catch (err) {
      // 409 ("not soft-deleted") is a no-op success from the user's
      // perspective — the account is already restorable/restored. Any
      // other failure surfaces an alert and leaves the gate in place so
      // the user can retry.
      const status = (err as { status?: number } | undefined)?.status;
      if (status !== 409) {
        Alert.alert(
          "Couldn't restore your account",
          "Something went wrong. Please try again.",
        );
        return;
      }
    }
    await profilePage.refresh();
    router.replace("/(app)/(tabs)");
  }, [restoreAccount, profilePage, router]);

  const onSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // signOut already surfaces its own error via useAuth().error; this
      // screen has nowhere better to show it, so it's a silent no-op — the
      // user can retry the button (AuthGate keeps them here regardless).
    }
  }, [signOut]);

  return (
    <RestoreAccountPresenter
      purgeAfter={purgeAfter}
      isRestoring={restoreAccount.isPending}
      onRestore={onRestore}
      onSignOut={onSignOut}
    />
  );
}

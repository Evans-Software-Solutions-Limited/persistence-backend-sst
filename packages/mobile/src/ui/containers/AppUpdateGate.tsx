import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Linking, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/adapters/api";
import { fetchPolicy, readPolicy } from "@/adapters/appUpdate/loadPolicy";
import {
  requiredVersion,
  storeUrl,
  updateRequired,
  type AppVersionPolicy,
} from "@/adapters/appUpdate/policy";
import { ThemeProvider } from "@/ui/theme";
import { RequiredUpdatePresenter } from "@/ui/presenters/RequiredUpdatePresenter";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";

/** Gate precedes AppProviders: unsupported binaries never initialize Together. */
export function AppUpdateGate({ children }: { children: ReactNode }) {
  const bootstrapped = useRef(false);
  const release =
    !__DEV__ && (Platform.OS === "ios" || Platform.OS === "android");
  const [policy, setPolicy] = useState<AppVersionPolicy | null>(null),
    [ready, setReady] = useState(!release),
    [retry, setRetry] = useState(0),
    [opening, setOpening] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!release) return;
    let alive = true;
    let running: Promise<void> | undefined;
    let controller: AbortController | undefined;
    const environment = getApiBaseUrl();
    const check = () => {
      if (running) return;
      running = (async () => {
        if (!bootstrapped.current) {
          const cached = await readPolicy(AsyncStorage, environment);
          if (!alive) return;
          if (cached) setPolicy(cached);
          bootstrapped.current = true;
        }
        controller = new AbortController();
        const timer = setTimeout(() => controller?.abort(), 3000);
        try {
          const next = await fetchPolicy(
            AsyncStorage,
            environment,
            controller.signal,
          );
          if (alive) setPolicy(next);
        } catch {
          /* Offline uses the cached policy plus the bundled binary floor. */
        } finally {
          clearTimeout(timer);
          if (alive) setReady(true);
        }
      })().finally(() => {
        running = undefined;
      });
    };
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      alive = false;
      controller?.abort();
      subscription.remove();
    };
  }, [release, retry]);
  if (!release) return children;
  const native = requireOptionalNativeModule<{
    nativeApplicationVersion: string | null;
    applicationId: string | null;
  }>("ExpoApplication");
  const nativeReady =
    !!requireOptionalNativeModule("TogetherLan") &&
    !!requireOptionalNativeModule("TogetherNearby");
  const platform = Platform.OS as "ios" | "android",
    minimum = requiredVersion(policy, platform);
  // The manifest can identify the distribution's store listing, never its
  // installed binary version. Older binaries may not have ExpoApplication.
  const manifestId =
    platform === "ios"
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Constants.expoConfig?.android?.package;
  const url = storeUrl(platform, native?.applicationId ?? manifestId ?? null);
  if (!ready)
    return (
      <ThemeProvider>
        <PLogoDrawLoader />
      </ThemeProvider>
    );
  if (!updateRequired(native?.nativeApplicationVersion, minimum, nativeReady))
    return children;
  return (
    <ThemeProvider>
      <RequiredUpdatePresenter
        minimum={minimum}
        storeAvailable={!!url}
        busy={opening}
        error={error}
        onRetry={() => {
          setError("");
          setRetry((x) => x + 1);
        }}
        onUpdate={() => {
          if (!url || opening) return;
          setOpening(true);
          setError("");
          void Linking.openURL(url)
            .catch(() =>
              setError(
                "Could not open the store. Try again, or update Persistence in your app store.",
              ),
            )
            .finally(() => setOpening(false));
        }}
      />
    </ThemeProvider>
  );
}

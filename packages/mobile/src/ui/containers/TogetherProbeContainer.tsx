import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Share } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Redirect } from "expo-router";
import { openDatabaseSync } from "expo-sqlite";
import {
  assertFixtureVerifies,
  runCryptoProbe,
  type CryptoProbeReport,
} from "@/diagnostics/together/cryptoProbe";
import {
  getCryptoBackend,
  installCryptoBackend,
  installNativeTogetherCrypto,
  nobleCryptoBackend,
  type CryptoBackendName,
} from "@/adapters/together/security/cryptoBackend";
import { HOME_ROUTE } from "@/application/notifications/deep-link";
import { TogetherProbePresenter } from "@/ui/presenters/TogetherProbePresenter";

/**
 * Diagnostic screens never ship to production users: the probe mounts only on
 * development builds or non-production variants (`extra.appVariant` is set by
 * `app.config.ts`; unset collapses to "production", which hides it).
 */
export function isTogetherProbeAllowed(
  variant: unknown = Constants.expoConfig?.extra?.appVariant,
  devBuild: boolean = __DEV__,
): boolean {
  return devBuild || (typeof variant === "string" && variant !== "production");
}

/**
 * Hidden diagnostic container for the Together crypto probe (PER-20 / D16).
 * No navigation entry; reached by deep link (`<scheme>://together-probe`) on
 * staging or development builds. Production builds redirect to Home.
 */
export function TogetherProbeContainer() {
  if (!isTogetherProbeAllowed()) return <Redirect href={HOME_ROUTE} />;
  return <TogetherProbeSession />;
}

function engineLabel(): string {
  const internal = (globalThis as { HermesInternal?: unknown }).HermesInternal;
  return internal ? "Hermes" : "not Hermes (JSC/other)";
}

function TogetherProbeSession() {
  const [report, setReport] = useState<CryptoProbeReport | null>(null);
  const [progress, setProgress] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const [backend, setBackend] = useState<CryptoBackendName>(
    () => getCryptoBackend().name,
  );

  useEffect(() => {
    // Same installation path as the Together factories; noble stays if absent.
    setBackend(installNativeTogetherCrypto());
  }, []);

  const toggleBackend = useCallback(() => {
    if (running.current) return;
    if (getCryptoBackend().name === "native") {
      installCryptoBackend(nobleCryptoBackend);
      setBackend("noble");
    } else {
      setBackend(installNativeTogetherCrypto(undefined, { force: true }));
    }
    setReport(null);
    setProgress("Idle");
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setReport(null);
    setProgress("Verifying fixture…");
    let db: ReturnType<typeof openDatabaseSync> | null = null;
    try {
      assertFixtureVerifies();
      db = openDatabaseSync("together-crypto-probe.db");
      const next = await runCryptoProbe({
        database: db,
        environment: {
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          deviceModel: Device.modelName ?? null,
          devBuild: __DEV__,
        },
        onProgress: (step, index, total) =>
          setProgress(
            index >= total
              ? `Done (${total} benchmarks)`
              : `${index + 1}/${total} ${step}`,
          ),
      });
      setReport(next);
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setProgress("Failed");
    } finally {
      db?.closeSync();
      running.current = false;
    }
  }, []);

  const share = useCallback(async () => {
    if (!report) return;
    try {
      await Share.share({
        message: JSON.stringify(report, null, 2),
        title: "Together crypto probe",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [report]);

  return (
    <TogetherProbePresenter
      engine={engineLabel()}
      platform={Platform.OS}
      osVersion={String(Platform.Version)}
      devBuild={__DEV__}
      backend={backend}
      progress={progress}
      error={error}
      report={report}
      onRun={run}
      onShare={share}
      onToggleBackend={toggleBackend}
    />
  );
}

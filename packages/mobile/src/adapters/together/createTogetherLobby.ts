/* eslint-disable @typescript-eslint/no-require-imports -- Native imports remain lazy for platform-specific composition. */
import type { TogetherProvisioningPort } from "@/domain/ports/togetherProvisioning.port";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";
import type { TogetherRecoveryApi } from "@/domain/ports/togetherOfflineApi.port";
import type { TogetherLobbyControllerOptions } from "./lobbyController";
import type { Exercise } from "@/domain/models/exercise";
import { ownCustomExercises } from "./ownCustomExercises";

/** Explicit composition: the app-wide update gate owns native binary compatibility. */
export function createTogetherLobby(
  provisioning: TogetherProvisioningPort | undefined,
  environment: string,
  enabled = false,
  recovery?: TogetherRecoveryApi,
  /** `Platform.OS`; iOS starts on the LAN module's peer-to-peer Wi-Fi (PER-64). */
  platform?: string,
  /** The cached exercise library; a host shares its own custom ones (PER-60). */
  exercises?: () => readonly Exercise[],
): TogetherLobbyPort | undefined {
  if (!enabled || !provisioning) return undefined;
  try {
    (
      require("./security/cryptoBackend") as typeof import("./security/cryptoBackend")
    ).installNativeTogetherCrypto();
    const { togetherLan } =
      require("../../../modules/together-lan") as typeof import("../../../modules/together-lan");
    const { togetherNearby } =
      require("../../../modules/together-nearby") as typeof import("../../../modules/together-nearby");
    const { getRandomBytes, randomUUID } =
      require("expo-crypto") as typeof import("expo-crypto");
    const { openDatabaseSync } =
      require("expo-sqlite") as typeof import("expo-sqlite");
    const { requestHash } =
      require("./security/identity") as typeof import("./security/identity");
    const { TogetherLobbyController } =
      require("./lobbyController") as typeof import("./lobbyController");
    const { withNativeDiagnostics } =
      require("./nativeDiagnostics") as typeof import("./nativeDiagnostics");
    const { togetherLog } =
      require("@/diagnostics/together/togetherLog") as typeof import("@/diagnostics/together/togetherLog");
    // Error reporting is optional: a reporter that cannot load never takes
    // Together down with it.
    let report: TogetherLobbyControllerOptions["report"];
    try {
      report = (
        require("@/diagnostics/together/togetherReport") as typeof import("@/diagnostics/together/togetherReport")
      ).reportTogetherFailure;
    } catch {
      report = undefined;
    }
    const db = openDatabaseSync(
      `together-lobby-${requestHash(environment)}.db`,
    );
    try {
      const controller = new TogetherLobbyController({
        enabled: true,
        provisioning,
        native:
          togetherLan && withNativeDiagnostics(togetherLan, togetherLog, "lan"),
        nearby:
          togetherNearby &&
          withNativeDiagnostics(togetherNearby, togetherLog, "nearby"),
        defaultTransport: platform === "ios" ? "lan" : undefined,
        database: db,
        diagnostics: togetherLog,
        report,
        randomBytes: getRandomBytes,
        randomUUID,
        recovery,
        customExercises: exercises
          ? (ownerId, ids) => ownCustomExercises(exercises(), ownerId, ids)
          : undefined,
      });
      const dispose = controller.dispose.bind(controller);
      let disposed = false;
      controller.dispose = async () => {
        if (disposed) return;
        disposed = true;
        try {
          await dispose();
        } finally {
          db.closeSync();
        }
      };
      return controller;
    } catch (error) {
      db.closeSync();
      throw error;
    }
  } catch {
    return undefined;
  }
}

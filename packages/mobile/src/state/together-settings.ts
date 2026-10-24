import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";

/**
 * useTogetherSettings — the athlete's Together defaults (PER-60, canvas row 1b).
 *
 * Start on the solo strip, Start a shared session and the workout-detail row
 * all open with these values preset ("Picked from your Together settings").
 * Nearby and Training partners are the shipped defaults; sharing defaults to
 * numbers and previous values on, fill-in off (canvas row 4). The Together
 * settings screen (hub settings button) edits them; the one-session sheet
 * changes them per session only.
 *
 * Persisted per account so a shared device never presets one athlete's
 * choices for another. `rehydrate(userId)` runs on sign-in; `reset()` returns
 * to defaults on sign-out.
 */

export type TogetherConnectionMode = "local" | "online";
/** What every new session shares with the people in it (canvas row 4, PER-60). */
export interface TogetherSharingDefaults {
  /** Show my numbers: partners see your weights and reps, not only progress. */
  numbers: boolean;
  /** Share previous values: your last numbers in their Prev column. */
  previous: boolean;
  /** Let others fill in my sets. */
  logging: boolean;
}
export interface TogetherDefaults {
  connection: TogetherConnectionMode;
  audience: TogetherLobbyAudience;
  sharing: TogetherSharingDefaults;
}
export const TOGETHER_DEFAULTS: TogetherDefaults = {
  connection: "local",
  audience: "friends",
  sharing: { numbers: true, previous: true, logging: false },
};
/** v2 adds `sharing`; a v1 record is read with the shipped sharing defaults. */
const STORAGE_PREFIX = "persistence.together.defaults.v2";
const LEGACY_PREFIX = "persistence.together.defaults.v1";
const key = (userId: string) => `${STORAGE_PREFIX}:${userId}`;

function isSharing(value: unknown): value is TogetherSharingDefaults {
  return (
    typeof value === "object" &&
    value !== null &&
    (["numbers", "previous", "logging"] as const).every(
      (k) => typeof (value as TogetherSharingDefaults)[k] === "boolean",
    )
  );
}
function readDefaults(value: unknown): TogetherDefaults | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !["local", "online"].includes(
      String((value as TogetherDefaults).connection),
    ) ||
    !["invite-only", "friends", "open"].includes(
      String((value as TogetherDefaults).audience),
    )
  )
    return undefined;
  const v = value as TogetherDefaults;
  return {
    connection: v.connection,
    audience: v.audience,
    sharing: isSharing(v.sharing) ? v.sharing : TOGETHER_DEFAULTS.sharing,
  };
}

/** Open nearby is Nearby-only: an Online default demotes it to Training partners. */
export function normaliseTogetherDefaults(
  value: TogetherDefaults,
): TogetherDefaults {
  return value.connection === "online" && value.audience === "open"
    ? { ...value, connection: "online", audience: "friends" }
    : value;
}

export interface TogetherSettingsState extends TogetherDefaults {
  /** The account the current values belong to; null before rehydrate. */
  userId: string | null;
  rehydrate: (userId: string) => Promise<void>;
  setDefaults: (
    next: Partial<Omit<TogetherDefaults, "sharing">> & {
      sharing?: Partial<TogetherSharingDefaults>;
    },
  ) => Promise<void>;
  reset: () => void;
}

export const useTogetherSettings = create<TogetherSettingsState>(
  (set, get) => ({
    ...TOGETHER_DEFAULTS,
    userId: null,
    rehydrate: async (userId) => {
      set({ ...TOGETHER_DEFAULTS, userId });
      try {
        const raw =
          (await AsyncStorage.getItem(key(userId))) ??
          (await AsyncStorage.getItem(`${LEGACY_PREFIX}:${userId}`));
        if (get().userId !== userId) return;
        const parsed = readDefaults(raw ? JSON.parse(raw) : null);
        if (parsed) set(normaliseTogetherDefaults(parsed));
      } catch {
        // A corrupt or missing record keeps the shipped defaults.
      }
    },
    setDefaults: async (next) => {
      const { userId } = get();
      const value = normaliseTogetherDefaults({
        connection: next.connection ?? get().connection,
        audience: next.audience ?? get().audience,
        sharing: { ...get().sharing, ...(next.sharing ?? {}) },
      });
      set(value);
      if (!userId) return;
      try {
        await AsyncStorage.setItem(key(userId), JSON.stringify(value));
      } catch {
        // The in-memory value is already applied; persistence is best effort.
      }
    },
    reset: () => set({ ...TOGETHER_DEFAULTS, userId: null }),
  }),
);

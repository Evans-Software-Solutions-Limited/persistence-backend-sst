import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";

/**
 * useTogetherSettings — the athlete's Together defaults (PER-60, canvas row 1b).
 *
 * Start on the solo strip, Start a shared session and the workout-detail row
 * all open with these values preset ("Picked from your Together settings").
 * Nearby and Training partners are the shipped defaults. The Together settings
 * screen that edits them (hub cog) lands with the sharing PR; until then the
 * one-session sheet is the only place they are changed, per session only.
 *
 * Persisted per account so a shared device never presets one athlete's
 * choices for another. `rehydrate(userId)` runs on sign-in; `reset()` returns
 * to defaults on sign-out.
 */

export type TogetherConnectionMode = "local" | "online";
export interface TogetherDefaults {
  connection: TogetherConnectionMode;
  audience: TogetherLobbyAudience;
}
export const TOGETHER_DEFAULTS: TogetherDefaults = {
  connection: "local",
  audience: "friends",
};
const STORAGE_PREFIX = "persistence.together.defaults.v1";
const key = (userId: string) => `${STORAGE_PREFIX}:${userId}`;

function isDefaults(value: unknown): value is TogetherDefaults {
  return (
    typeof value === "object" &&
    value !== null &&
    ((value as TogetherDefaults).connection === "local" ||
      (value as TogetherDefaults).connection === "online") &&
    ["invite-only", "friends", "open"].includes(
      (value as TogetherDefaults).audience,
    )
  );
}

/** Open nearby is Nearby-only: an Online default demotes it to Training partners. */
export function normaliseTogetherDefaults(
  value: TogetherDefaults,
): TogetherDefaults {
  return value.connection === "online" && value.audience === "open"
    ? { connection: "online", audience: "friends" }
    : value;
}

export interface TogetherSettingsState extends TogetherDefaults {
  /** The account the current values belong to; null before rehydrate. */
  userId: string | null;
  rehydrate: (userId: string) => Promise<void>;
  setDefaults: (next: Partial<TogetherDefaults>) => Promise<void>;
  reset: () => void;
}

export const useTogetherSettings = create<TogetherSettingsState>(
  (set, get) => ({
    ...TOGETHER_DEFAULTS,
    userId: null,
    rehydrate: async (userId) => {
      set({ ...TOGETHER_DEFAULTS, userId });
      try {
        const raw = await AsyncStorage.getItem(key(userId));
        if (get().userId !== userId) return;
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isDefaults(parsed)) set(normaliseTogetherDefaults(parsed));
      } catch {
        // A corrupt or missing record keeps the shipped defaults.
      }
    },
    setDefaults: async (next) => {
      const { userId } = get();
      const value = normaliseTogetherDefaults({
        connection: next.connection ?? get().connection,
        audience: next.audience ?? get().audience,
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

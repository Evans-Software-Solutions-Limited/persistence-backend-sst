/* eslint-disable @typescript-eslint/no-require-imports -- The orientation module is loaded lazily: a 1.2.0 binary has no native module and would throw on import. */
/**
 * PER-137: screen orientation, guarded.
 *
 * From the build after 1.2.0 the native shell allows landscape
 * (`app.json` `orientation: "default"` + the `expo-screen-orientation`
 * plugin, approved by Brad on 26 Nov 2026), so the app locks itself to
 * portrait at start and only the progress photo viewer turns landscape.
 *
 * A 1.2.0 binary has no `ExpoScreenOrientation` native module, and
 * `expo-screen-orientation` throws on import there. If this JS ever reaches
 * a 1.2.0 phone over the air, every call here is a no-op: the binary is
 * portrait-locked natively, so the app simply stays portrait.
 */

type ScreenOrientationModule = typeof import("expo-screen-orientation");

let loaded: ScreenOrientationModule | null | undefined;

function load(): ScreenOrientationModule | null {
  if (loaded !== undefined) return loaded;
  try {
    const { requireOptionalNativeModule } =
      require("expo") as typeof import("expo");
    loaded = requireOptionalNativeModule("ExpoScreenOrientation")
      ? (require("expo-screen-orientation") as ScreenOrientationModule)
      : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Tests only: forget the cached module lookup. */
export function resetScreenOrientationForTests(): void {
  loaded = undefined;
}

/** True when this binary can change orientation (not 1.2.0). */
export function canChangeOrientation(): boolean {
  return load() !== null;
}

async function lock(
  pick: (m: ScreenOrientationModule) => number,
): Promise<void> {
  const mod = load();
  if (!mod) return;
  try {
    await mod.lockAsync(pick(mod));
  } catch (err) {
    // Never let an orientation failure break a screen.
    console.warn("[screenOrientation] lock failed:", err);
  }
}

/** The app's normal state: portrait, upright. */
export function lockPortrait(): Promise<void> {
  return lock((m) => m.OrientationLock.PORTRAIT_UP);
}

/** The progress photo viewer: either landscape side. */
export function lockLandscape(): Promise<void> {
  return lock((m) => m.OrientationLock.LANDSCAPE);
}

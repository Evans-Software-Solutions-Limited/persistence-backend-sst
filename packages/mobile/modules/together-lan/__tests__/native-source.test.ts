/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Native source contracts only: no Kotlin execution or device permission evidence.
const source = readFileSync(
  join(
    __dirname,
    "../android/src/main/java/expo/modules/togetherlan/TogetherLanModule.kt",
  ),
  "utf8",
);
it("gates every LAN/hotspot entry point before native networking", () => {
  for (const method of [
    "startHost",
    "startDiscovery",
    "startHotspotHost",
    "startHotspotDiscovery",
  ]) {
    expect(source).toMatch(
      new RegExp(`AsyncFunction\\("${method}"\\)[^\\n]*-> start\\(promise\\)`),
    );
  }
  expect(source).toContain(
    "Build.VERSION.SDK_INT >= 37 && context.applicationInfo.targetSdkVersion >= 37",
  );
});
it("invalidates pending starts on stop/destruction before late grants can start networking", () => {
  const stop = source.slice(source.indexOf("  private fun stopAll()"));
  expect(stop.indexOf("generation++")).toBeLessThan(
    stop.indexOf('pendingStart?.reject("cancelled"'),
  );
  expect(source).toMatch(/OnDestroy\s*\{\s*post \{ stopAll\(\);/);
  const callback = source.slice(source.indexOf("manager.askForPermissions"));
  expect(
    callback.indexOf("generation != token || pendingStart !== promise"),
  ).toBeLessThan(
    callback.indexOf(
      "if (manager.hasGrantedPermissions(localPermission)) finish()",
    ),
  );
  expect(callback).toContain('promise.reject("permission_denied"');
});
it("does not bring Android 17 permission in through the library manifest on target 36", () => {
  const manifest = readFileSync(
    join(
      __dirname,
      "../../together-nearby/android/src/main/AndroidManifest.xml",
    ),
    "utf8",
  );
  expect(manifest).not.toContain("ACCESS_LOCAL_NETWORK");
  const nearby = readFileSync(
    join(
      __dirname,
      "../../together-nearby/android/src/main/java/expo/modules/togethernearby/TogetherNearbyModule.kt",
    ),
    "utf8",
  );
  expect(nearby).toContain("Build.VERSION.SDK_INT >= 37 && targetSdk >= 37");
});

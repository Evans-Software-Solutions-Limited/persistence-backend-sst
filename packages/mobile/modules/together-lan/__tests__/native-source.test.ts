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
it("gates every LAN entry point before native networking and exposes no hotspot-owner mode", () => {
  expect(source).not.toMatch(/Hotspot|hotspotOwner/);
  for (const method of ["startHost", "startDiscovery"]) {
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

// iOS: the LAN module is the peer-to-peer Wi-Fi transport (TRANSPORT-ADR § Local transport by platform).
const swift = readFileSync(
  join(__dirname, "../ios/TogetherLanModule.swift"),
  "utf8",
);
it("runs peer-to-peer Wi-Fi on iOS with cellular prohibited and no hard Wi-Fi interface requirement", () => {
  const parameters = swift.slice(
    swift.indexOf("private func parameters()"),
    swift.indexOf("private func emit("),
  );
  expect(parameters).toContain("parameters.includePeerToPeer = true");
  expect(parameters).toContain(
    "parameters.prohibitedInterfaceTypes = [.cellular]",
  );
  expect(parameters).not.toContain("requiredInterfaceType");
  // Every listener, browser and outbound connection shares those parameters.
  expect(swift).toMatch(
    /NWConnection\(to: endpoint, using: self\.parameters\(\)\)/,
  );
  expect(swift).toMatch(/NWListener\(using: parameters\(\)\)/);
  expect(swift).toMatch(/NWBrowser\(for: [^\n]*using: parameters\(\)\)/);
  expect(
    swift.match(/using: (self\.)?parameters\(\)/g)?.length ?? 0,
  ).toBeGreaterThanOrEqual(3);
});

it("holds a connecting peer for 30 s on both platforms, matched to the Nearby module", () => {
  expect(swift).toContain("private let connectSeconds: Double = 30");
  expect(swift).toContain("deadline(id, seconds: connectSeconds)");
  expect(swift).not.toContain("deadline(id, seconds: 10)");
  expect(source).toContain("private const val CONNECT_DEADLINE_SECONDS = 30L");
  expect(source).toContain("deadline(id, peer, CONNECT_DEADLINE_SECONDS)");
  expect(source).toContain("(CONNECT_DEADLINE_SECONDS * 1000).toInt()");
});

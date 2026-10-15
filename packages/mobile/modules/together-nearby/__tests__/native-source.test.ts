/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
/** Source contract only: SDK compilation and physical deadline/reconnect evidence remain owner gates. */
it("binds an iOS write timeout to its original peer while always rejecting that write", () => {
  const source = readFileSync(
    join(__dirname, "../ios/TogetherNearbyModule.swift"),
    "utf8",
  );
  const send = source.slice(
    source.indexOf("  func send("),
    source.indexOf("  private func deadline("),
  );
  const timer = send.slice(
    send.indexOf("let timer = DispatchWorkItem"),
    send.indexOf("DispatchQueue.main.asyncAfter"),
  );
  expect(timer).toContain("[weak self, weak peer]");
  expect(timer).toMatch(
    /if let self, let peer, self\.peers\[id\] === peer\s*\{\s*self\.drop\(id, "write_timeout"\)\s*\}\s*promise\.reject\("write_timeout"/,
  );
  expect(timer).toContain("guard !settled else { return }; settled = true");
});

it("captures permission requirements before prompting and tolerates destroyed context during cleanup", () => {
  const source = readFileSync(
    join(
      __dirname,
      "../android/src/main/java/expo/modules/togethernearby/TogetherNearbyModule.kt",
    ),
    "utf8",
  );
  const start = source.slice(
    source.indexOf("  private fun start("),
    source.indexOf("  private fun lifecycle("),
  );
  expect(
    start.indexOf(
      "val required = permissions(context.applicationInfo.targetSdkVersion)",
    ),
  ).toBeLessThan(start.indexOf("askForPermissions"));
  const callback = start.slice(start.indexOf("askForPermissions"));
  expect(callback).not.toContain("permissions()");
  expect(callback).toContain(
    "appContext.reactContext == null || !permissionManager.hasGrantedPermissions(*required)",
  );
  expect(callback).toContain('failure(token, promise, "permission_denied")');
  expect(callback).toContain("}, *required)");
  const stop = source.slice(
    source.indexOf("  private fun stop()"),
    source.indexOf("  private fun failure("),
  );
  expect(stop).toContain("connectionsClient?.let");
  expect(stop).not.toContain("client.");
  expect(source).toContain("connectionsClient?.disconnectFromEndpoint(id)");
});

it("links a strong sdallocx in the always-linked module object so BoringSSL's weak fallback cannot be coalesced onto ReactNativeDependencies", () => {
  // TestFlight crash 7D536D3B (14 Oct 2026): OPENSSL_free -> sdallocx jumped into
  // ReactNativeDependencies.framework __DATA and the kernel killed the app with
  // "CODESIGNING 2 Invalid Page". A separate C file in the static archive is
  // never pulled (BoringSSL's own object satisfies the symbol), so the strong
  // definition must be @_cdecl in the module's Swift file.
  const source = readFileSync(
    join(__dirname, "../ios/TogetherNearbyModule.swift"),
    "utf8",
  );
  expect(source).toMatch(
    /@_cdecl\("sdallocx"\)\npublic func \w+\(_ ptr: UnsafeMutableRawPointer\?, _ size: Int, _ flags: Int32\) \{\n\s*free\(ptr\)\n\}/,
  );
  const podspec = readFileSync(
    join(__dirname, "../ios/TogetherNearby.podspec"),
    "utf8",
  );
  expect(podspec).toContain("s.source_files = '**/*.swift'");
});

it("reports Nearby unavailable in the iOS Simulator so the app takes the LAN fallback there", () => {
  const source = readFileSync(
    join(__dirname, "../ios/TogetherNearbyModule.swift"),
    "utf8",
  );
  expect(source).toMatch(
    /#if targetEnvironment\(simulator\)\n\s*Constants\(\["available": false\]\)\n\s*#else\n\s*Constants\(\["available": true\]\)\n\s*#endif/,
  );
});

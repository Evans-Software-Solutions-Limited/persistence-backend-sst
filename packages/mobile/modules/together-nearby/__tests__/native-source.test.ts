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

it("emits SDK detail as log events, keeps NSError text in rejections and codes rejected or never-ready closures", () => {
  const source = readFileSync(
    join(__dirname, "../ios/TogetherNearbyModule.swift"),
    "utf8",
  );
  expect(source).toContain(
    'emit(["type": "log", "message": message, "data": data])',
  );
  for (const line of [
    'self.log(self.host ? "startAdvertising failed" : "startDiscovery failed", self.detail(error))',
    'self.log("requestConnection failed", failure)',
    'log("didFind", ["endpointId": id, "lobbyId": lobby ?? "", "valid": valid',
    'log("connection request refused"',
    'log("verification", ["peerId": id, "accept": accept])',
    'log("state \\(name)"',
    'log("drop", ["peerId": id, "code": code ?? ""',
  ])
    expect(source).toContain(line);
  expect(source).toMatch(
    /promise\.reject\("nearby_unavailable", "Nearby could not start \(check Bluetooth and local-network permissions\): \\\(error\.localizedDescription\)"\)/,
  );
  expect(source).toMatch(
    /promise\.reject\("connect_failed", "Nearby connection failed: \\\(error\.localizedDescription\)"\)/,
  );
  expect(source).toContain('case .rejected: drop(id, "connection_rejected")');
  expect(source).toContain(
    'case .disconnected: drop(id, peer.ready ? nil : "connection_closed")',
  );
  // Log lines never carry frame contents.
  expect(source).not.toMatch(/log\([^\n]*"frame": frame/);
});

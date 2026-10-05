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
    source.indexOf("  func deadline("),
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

import {
  parsePolicy,
  olderThan,
  requiredVersion,
  updateRequired,
  storeUrl,
  isVersion,
} from "../policy";
it.each([
  ["1.1.2", "1.1.3", true],
  ["1.1.3", "1.1.3", false],
  ["1.10.0", "1.9.9", false],
  ["1.0.0", "2.0.0", true],
  ["2.0.0", "1.99.99", false],
  ["1.2.1", "1.2.0", false],
])("compares native versions numerically %s/%s", (a, b, want) =>
  expect(olderThan(a, b)).toBe(want),
);
it.each([undefined, null, "1.2", "1.2.3-beta", "01.2.3", {}, "100000.1.1"])(
  "rejects an unknown version %s",
  (v) => {
    expect(isVersion(v)).toBe(false);
    expect(updateRequired(v, "1.1.3", true)).toBe(true);
  },
);
it("applies platform policy without allowing a downgrade below bundled native requirements", () => {
  const p = { iosMinimumVersion: "2.0.0", androidMinimumVersion: "1.0.0" };
  expect(parsePolicy(p)).toEqual(p);
  expect(requiredVersion(p, "ios")).toBe("2.0.0");
  expect(requiredVersion(p, "android")).toBe("1.1.3");
  expect(requiredVersion(null, "ios")).toBe("1.1.3");
  expect(requiredVersion(null, "android")).toBe("1.1.3");
  expect(updateRequired("1.1.3", "1.1.3", true)).toBe(false);
  expect(updateRequired("1.1.3", "1.1.3", false)).toBe(true);
});
it.each([
  null,
  "bad",
  {},
  { iosMinimumVersion: "1.1.3", androidMinimumVersion: "no" },
])("rejects incomplete policy", (p) => expect(parsePolicy(p)).toBeNull());
it("never sends testing variants to an unrelated production listing", () => {
  expect(storeUrl("ios", "com.bradleyevans96.persistence")).toContain(
    "id6755091280",
  );
  expect(storeUrl("android", "com.bradleyevans96.persistence")).toContain(
    "id=com.bradleyevans96.persistence",
  );
  expect(storeUrl("ios", "com.bradleyevans96.persistence.staging")).toBeNull();
  expect(storeUrl("android", null)).toBeNull();
});

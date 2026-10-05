import { togetherTestEnabled } from "../testGate";
it.each([undefined, "true", "false", "TRUE", "1", ""])(
  "production rejects the test flag %s",
  (flag) => {
    expect(togetherTestEnabled(false, flag)).toBe(false);
  },
);
it.each([undefined, "false", "TRUE", "1", ""])(
  "development requires exact opt-in %s",
  (flag) => {
    expect(togetherTestEnabled(true, flag)).toBe(false);
  },
);
it("allows explicit development-only test capability", () =>
  expect(togetherTestEnabled(true, "true")).toBe(true));

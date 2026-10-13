import { isDiagnosticsAllowed } from "../allowed";

it("allows development builds and non-production variants only", () => {
  expect(isDiagnosticsAllowed("production", false)).toBe(false);
  expect(isDiagnosticsAllowed("staging", false)).toBe(true);
  expect(isDiagnosticsAllowed("production", true)).toBe(true);
  expect(isDiagnosticsAllowed(undefined, false)).toBe(false);
});

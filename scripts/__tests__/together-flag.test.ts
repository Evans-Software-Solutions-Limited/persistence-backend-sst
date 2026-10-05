import { describe, expect, it } from "vitest";
import { togetherEnabledForDeployment } from "../../infra/togetherFlag";

describe("Together deployment rollback", () => {
  it("retains the approved enabled release default", () => {
    expect(togetherEnabledForDeployment(undefined)).toBe(true);
  });
  it.each(["false", "False", "FALSE", "0", "off", " OFF "])(
    "disables infrastructure for %s",
    (value) => expect(togetherEnabledForDeployment(value)).toBe(false),
  );
  it.each(["true", "True", "TRUE", "1", "on", " ON "])(
    "enables infrastructure for %s",
    (value) => expect(togetherEnabledForDeployment(value)).toBe(true),
  );
  it.each(["", " ", "flase", "disabled", "2"])(
    "rejects ambiguous configuration %j before provisioning",
    (value) =>
      expect(() => togetherEnabledForDeployment(value)).toThrow(
        "TOGETHER_ENABLED",
      ),
  );
});

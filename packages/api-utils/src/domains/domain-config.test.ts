import { describe, expect, it } from "vitest";
import { BASE_DOMAIN, getDomainConfig, getEnvironment } from "./domain-config";

describe("domain-config", () => {
  describe("BASE_DOMAIN", () => {
    it("is persistence.evans-software-solutions.com", () => {
      expect(BASE_DOMAIN).toBe("persistence.evans-software-solutions.com");
    });
  });

  describe("getEnvironment", () => {
    it("returns production for the production stage", () => {
      expect(getEnvironment("production")).toBe("production");
    });

    it("returns staging for the staging stage", () => {
      expect(getEnvironment("staging")).toBe("staging");
    });

    it("returns dev for any other stage name", () => {
      expect(getEnvironment("dev")).toBe("dev");
      expect(getEnvironment("brad")).toBe("dev");
      expect(getEnvironment("feature-x")).toBe("dev");
      expect(getEnvironment("pr-1")).toBe("dev");
    });
  });

  describe("getDomainConfig", () => {
    it("returns api.{BASE_DOMAIN} for production", () => {
      expect(getDomainConfig("production").apiHost).toBe(`api.${BASE_DOMAIN}`);
    });

    it("returns api.staging.{BASE_DOMAIN} for staging", () => {
      expect(getDomainConfig("staging").apiHost).toBe(
        `api.staging.${BASE_DOMAIN}`,
      );
    });

    it("returns null for dev / personal / unknown stages", () => {
      expect(getDomainConfig("dev").apiHost).toBeNull();
      expect(getDomainConfig("brad").apiHost).toBeNull();
      expect(getDomainConfig("pr-42").apiHost).toBeNull();
      expect(getDomainConfig("feature-active-session").apiHost).toBeNull();
    });
  });
});

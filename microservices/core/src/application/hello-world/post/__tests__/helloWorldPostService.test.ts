import { describe, it, expect } from "vitest";
import { HelloWorldPostRepositoryService } from "../helloWorldPostService";

describe("HelloWorldPostService", () => {
  it("should export a service instance", () => {
    expect(HelloWorldPostRepositoryService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(HelloWorldPostRepositoryService).toHaveProperty("handle");
  });

  it("should have the service configured", () => {
    expect(HelloWorldPostRepositoryService).toBeTruthy();
  });
});

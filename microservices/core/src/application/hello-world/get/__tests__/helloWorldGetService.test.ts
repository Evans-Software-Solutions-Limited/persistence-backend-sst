import { describe, it, expect } from "vitest";
import { HelloWorldRepositoryService } from "../helloWorldGetService";

describe("HelloWorldGetService", () => {
  it("should export a service instance", () => {
    expect(HelloWorldRepositoryService).toBeDefined();
  });

  it("should be an Elysia application", () => {
    expect(HelloWorldRepositoryService).toHaveProperty("handle");
  });

  it("should have the service configured", () => {
    expect(HelloWorldRepositoryService).toBeTruthy();
  });
});

import { describe, it, expect } from "vitest";
import { HelloWorldRepository } from "../helloWorldRepository";

describe("HelloWorldRepository", () => {
  let repository: HelloWorldRepository;

  beforeEach(() => {
    repository = new HelloWorldRepository();
  });

  it("should return 'Hello, world!' from get method", async () => {
    const result = await repository.get();
    expect(result).toBe("Hello, world!");
  });

  it("should return personalized greeting from create method", async () => {
    const result = await repository.create("Alice");
    expect(result).toBe("Hello, Alice!");
  });

  it("should return personalized greeting with different names", async () => {
    const result = await repository.create("Bob");
    expect(result).toBe("Hello, Bob!");
  });

  it("should handle empty string names", async () => {
    const result = await repository.create("");
    expect(result).toBe("Hello, !");
  });
});

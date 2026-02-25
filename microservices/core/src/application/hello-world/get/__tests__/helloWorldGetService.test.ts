import { describe, it, expect } from "vitest";
import { HelloWorldRepositoryService } from "../helloWorldGetService";
import { HelloWorldRepository } from "../../repositories/helloWorldRepository";

describe("HelloWorldGetService", () => {
  it("should provide HelloWorldRepository as a decorated service", async () => {
    const instance = HelloWorldRepositoryService.singleton({} as any, {});
    
    expect(instance).toBeDefined();
    expect(instance.HelloWorldRepository).toBeDefined();
    expect(instance.HelloWorldRepository).toBeInstanceOf(HelloWorldRepository);
  });

  it("should have access to repository get method through service", async () => {
    const instance = HelloWorldRepositoryService.singleton({} as any, {});
    
    const result = await instance.HelloWorldRepository.get();
    expect(result).toBe("Hello, world!");
  });

  it("should have access to repository create method through service", async () => {
    const instance = HelloWorldRepositoryService.singleton({} as any, {});
    
    const result = await instance.HelloWorldRepository.create("TestUser");
    expect(result).toBe("Hello, TestUser!");
  });
});

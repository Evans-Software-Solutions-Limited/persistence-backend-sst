import { describe, it, expect } from "vitest";
import { HelloWorldPostRepositoryService } from "../helloWorldPostService";
import { HelloWorldRepository } from "../../repositories/helloWorldRepository";

describe("HelloWorldPostService", () => {
  it("should provide HelloWorldRepository as a decorated service", async () => {
    const instance = HelloWorldPostRepositoryService.singleton({} as any, {});
    
    expect(instance).toBeDefined();
    expect(instance.HelloWorldRepository).toBeDefined();
    expect(instance.HelloWorldRepository).toBeInstanceOf(HelloWorldRepository);
  });

  it("should have access to repository create method through service", async () => {
    const instance = HelloWorldPostRepositoryService.singleton({} as any, {});
    
    const result = await instance.HelloWorldRepository.create("PostUser");
    expect(result).toBe("Hello, PostUser!");
  });

  it("should have access to repository get method through service", async () => {
    const instance = HelloWorldPostRepositoryService.singleton({} as any, {});
    
    const result = await instance.HelloWorldRepository.get();
    expect(result).toBe("Hello, world!");
  });
});

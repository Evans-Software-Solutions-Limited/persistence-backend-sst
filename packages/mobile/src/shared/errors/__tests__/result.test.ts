import { ok, fail, unwrap, type Result, type ApiError } from "../result";

describe("Result type", () => {
  describe("ok", () => {
    it("creates a success result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it("works with complex types", () => {
      const result = ok({ name: "Push Day", exercises: 6 });
      expect(result.ok).toBe(true);
      expect(result.value.name).toBe("Push Day");
    });
  });

  describe("fail", () => {
    it("creates a failure result", () => {
      const error: ApiError = {
        kind: "api",
        code: "not_found",
        message: "Not found",
      };
      const result = fail(error);
      expect(result.ok).toBe(false);
      expect(result.error).toEqual(error);
    });
  });

  describe("unwrap", () => {
    it("returns value for success", () => {
      const result = ok("hello");
      expect(unwrap(result)).toBe("hello");
    });

    it("throws for failure", () => {
      const error: ApiError = { kind: "api", code: "server", message: "Boom" };
      const result: Result<string, ApiError> = fail(error);
      expect(() => unwrap(result)).toThrow();
    });
  });

  describe("type narrowing", () => {
    it("narrows to success branch", () => {
      const result: Result<number, ApiError> = ok(10);
      if (result.ok) {
        // TypeScript should know result.value is number here
        const doubled: number = result.value * 2;
        expect(doubled).toBe(20);
      }
    });

    it("narrows to failure branch", () => {
      const error: ApiError = {
        kind: "api",
        code: "unauthorized",
        message: "No auth",
      };
      const result: Result<number, ApiError> = fail(error);
      if (!result.ok) {
        expect(result.error.code).toBe("unauthorized");
      }
    });
  });
});

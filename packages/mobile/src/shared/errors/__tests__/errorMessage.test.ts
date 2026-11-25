import { errorMessage } from "../errorMessage";

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a plain object's string message instead of [object Object]", () => {
    expect(
      errorMessage({ message: "This subscription has been canceled" }),
    ).toBe("This subscription has been canceled");
  });

  it("serialises a plain object without a string message", () => {
    expect(errorMessage({ code: "resource_missing", message: 42 })).toBe(
      '{"code":"resource_missing","message":42}',
    );
  });

  it("falls back to the object tag when the object cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe("[object Object]");
  });

  it("stringifies primitives", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(404)).toBe("404");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

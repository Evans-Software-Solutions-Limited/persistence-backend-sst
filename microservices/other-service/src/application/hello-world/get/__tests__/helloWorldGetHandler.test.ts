import { describe, it, expect } from "vitest";
import { getHelloWorldHandler } from "../helloWorldGetHandler";

describe("HelloWorldGetHandler", () => {
  it("should return 200 with message for GET /hello-world", async () => {
    const response = await getHelloWorldHandler.handle(
      new Request("http://localhost/hello-world", {
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("message");
    expect(body.message).toBe("Hello, world!");
  });

  it("should return correct content-type header", async () => {
    const response = await getHelloWorldHandler.handle(
      new Request("http://localhost/hello-world", {
        method: "GET",
      })
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("should return 404 for non-existent routes", async () => {
    const response = await getHelloWorldHandler.handle(
      new Request("http://localhost/non-existent", {
        method: "GET",
      })
    );

    expect(response.status).toBe(404);
  });
});

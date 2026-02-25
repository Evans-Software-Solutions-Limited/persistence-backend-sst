import { describe, it, expect } from "vitest";
import { postHelloWorldHandler } from "../helloWorldPostHandler";

describe("HelloWorldPostHandler", () => {
  it("should return 200 with message for POST /hello-world", async () => {
    const response = await postHelloWorldHandler.handle(
      new Request("http://localhost/hello-world", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("message");
    expect(body.message).toBe("Hello, World!");
  });

  it("should return correct content-type header", async () => {
    const response = await postHelloWorldHandler.handle(
      new Request("http://localhost/hello-world", {
        method: "POST",
      })
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("should return 404 for non-existent routes", async () => {
    const response = await postHelloWorldHandler.handle(
      new Request("http://localhost/non-existent", {
        method: "POST",
      })
    );

    expect(response.status).toBe(404);
  });

  it("should return 404 for GET method on POST-only endpoint", async () => {
    const response = await postHelloWorldHandler.handle(
      new Request("http://localhost/hello-world", {
        method: "GET",
      })
    );

    expect(response.status).toBe(404);
  });
});

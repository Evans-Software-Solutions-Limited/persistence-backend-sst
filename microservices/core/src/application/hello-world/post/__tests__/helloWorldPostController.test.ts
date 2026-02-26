import { describe, it, expect } from "vitest";
import { postHelloWorldController } from "../helloWorldPostController";

describe("HelloWorldPostController", () => {
  it("should return 200 with message for POST /hello-world-custom", async () => {
    const response = await postHelloWorldController.handle(
      new Request("http://localhost/hello-world-custom", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body).toHaveProperty("message");
    expect(body.message).toBe("Hello, CustomUser!");
  });

  it("should return correct content-type header", async () => {
    const response = await postHelloWorldController.handle(
      new Request("http://localhost/hello-world-custom", {
        method: "POST",
      }),
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("should return 404 for non-existent routes", async () => {
    const response = await postHelloWorldController.handle(
      new Request("http://localhost/non-existent", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });
});

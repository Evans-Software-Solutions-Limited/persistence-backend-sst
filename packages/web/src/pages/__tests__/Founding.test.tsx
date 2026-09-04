import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import Founding from "../Founding";

describe("Founding", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                consumer: { used: 37, cap: 200 },
                coach: { used: 4, cap: 20 },
              },
            }),
          ),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders live availability and keeps contributions separate from access", async () => {
    renderPage(<Founding />, { route: "/founding" });

    expect(
      screen.getByRole("heading", {
        name: "I turn 30 this month. A limited number of founding places.",
      }),
    ).toBeDefined();
    expect(await screen.findByText(/37 of 200/)).toBeDefined();
    expect(screen.getByText(/4 of 20/)).toBeDefined();
    expect(
      screen.getByText(/does not buy, guarantee, size, or extend access/i),
    ).toBeDefined();
    expect(screen.queryByText(/£30|£50|£99/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Pay/ })).toBeNull();
  });

  it("routes /founding to the founding page", () => {
    renderPage(<App />, { route: "/founding" });
    expect(screen.getByText("Founding access")).toBeDefined();
  });

  it("does not invent a count when availability fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    renderPage(<Founding />, { route: "/founding" });
    expect(await screen.findAllByText(/temporarily unavailable/)).toHaveLength(
      2,
    );
  });
});

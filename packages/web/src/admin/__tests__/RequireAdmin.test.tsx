import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { renderPage } from "@/test-utils";
import { RequireAdmin } from "../RequireAdmin";
import { saveSession, sessionFromTokens } from "../adminAuth";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}
const farFuture = Math.floor(Date.now() / 1000) + 3600;

function App() {
  return (
    <Routes>
      <Route path="/admin/login" element={<p>login page</p>} />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <p>secret panel</p>
          </RequireAdmin>
        }
      />
    </Routes>
  );
}

describe("RequireAdmin", () => {
  afterEach(() => saveSession(null));

  it("redirects to the login page without a session", async () => {
    renderPage(<App />, { route: "/admin" });
    await screen.findByText("login page");
  });

  it("shows the not-an-admin page for a signed-in non-admin", async () => {
    saveSession(
      sessionFromTokens(jwt({ exp: farFuture, email: "u@x.co" }), "rt"),
    );
    renderPage(<App />, { route: "/admin" });
    await screen.findByText(/isn't an admin/);
    expect(screen.queryByText("secret panel")).toBeNull();
  });

  it("renders the panel for an admin", async () => {
    saveSession(
      sessionFromTokens(
        jwt({ exp: farFuture, email: "b@x.co", app_metadata: { admin: true } }),
        "rt",
      ),
    );
    renderPage(<App />, { route: "/admin" });
    await screen.findByText("secret panel");
  });
});

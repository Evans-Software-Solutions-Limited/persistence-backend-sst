import { InMemoryAuthAdapter } from "./in-memory-auth.adapter";

describe("InMemoryAuthAdapter", () => {
  let auth: InMemoryAuthAdapter;

  beforeEach(() => {
    auth = new InMemoryAuthAdapter();
  });

  it("starts with no session", async () => {
    const result = await auth.getSession();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("signs in with email and returns session", async () => {
    const result = await auth.signInWithEmail("test@example.com", "password");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.email).toBe("test@example.com");
      expect(result.value.accessToken).toBe("test-token");
    }
  });

  it("signs out and clears session", async () => {
    await auth.signInWithEmail("test@example.com", "password");
    await auth.signOut();

    const result = await auth.getSession();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("notifies listeners on auth state change", async () => {
    const listener = jest.fn();
    auth.onAuthStateChange(listener);

    await auth.signInWithEmail("test@example.com", "password");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ email: "test@example.com" }),
    );

    await auth.signOut();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("unsubscribes listener", async () => {
    const listener = jest.fn();
    const unsubscribe = auth.onAuthStateChange(listener);

    unsubscribe();
    await auth.signInWithEmail("test@example.com", "password");
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns access token when signed in", async () => {
    expect(await auth.getAccessToken()).toBeNull();
    await auth.signInWithEmail("test@example.com", "password");
    expect(await auth.getAccessToken()).toBe("test-token");
  });

  it("returns error when shouldFail is set", async () => {
    auth.shouldFail = true;
    const result = await auth.signInWithEmail("test@example.com", "password");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
  });
});

/**
 * Each test imports a fresh module instance (`vi.resetModules()` +
 * dynamic import) so the module-level `scriptPromise` cache never leaks
 * between tests — the behaviour under test IS that cache, so tests need
 * to control it precisely rather than inherit whatever state a previous
 * test left behind.
 */
async function freshModule() {
  vi.resetModules();
  return import("../turnstile");
}

function scriptTag() {
  return document.head.querySelector<HTMLScriptElement>(
    'script[src*="challenges.cloudflare.com"]',
  );
}

describe("loadTurnstileScript", () => {
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    document.head
      .querySelectorAll('script[src*="challenges.cloudflare.com"]')
      .forEach((el) => el.remove());
  });

  it("resolves immediately when window.turnstile is already present", async () => {
    (window as unknown as { turnstile?: unknown }).turnstile = {
      render: vi.fn(),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    const { loadTurnstileScript } = await freshModule();
    await expect(loadTurnstileScript()).resolves.toBeUndefined();
    expect(scriptTag()).toBeNull();
  });

  it("injects one script tag and resolves once it fires load", async () => {
    const { loadTurnstileScript } = await freshModule();
    const promise = loadTurnstileScript();
    const script = scriptTag();
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("caches the in-flight promise so concurrent callers share one script tag", async () => {
    const { loadTurnstileScript } = await freshModule();
    const first = loadTurnstileScript();
    const second = loadTurnstileScript();
    expect(
      document.head.querySelectorAll('script[src*="challenges.cloudflare.com"]')
        .length,
    ).toBe(1);
    scriptTag()!.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("resolves a later call via the DOM marker once the tag is already loaded, without adding a duplicate tag", async () => {
    // First module instance loads the script for real.
    const mod1 = await freshModule();
    const first = mod1.loadTurnstileScript();
    scriptTag()!.dispatchEvent(new Event("load"));
    await first;

    // A second, independent module instance has no in-memory cache of its
    // own (simulating a second consumer / re-evaluated module) — it must
    // still short-circuit off the DOM's "already loaded" marker rather
    // than re-adding a script tag and waiting on a load event that will
    // never fire again.
    const mod2 = await freshModule();
    await expect(mod2.loadTurnstileScript()).resolves.toBeUndefined();
    expect(
      document.head.querySelectorAll('script[src*="challenges.cloudflare.com"]')
        .length,
    ).toBe(1);
  });

  it("clears the cached promise on a script error so a later call can retry", async () => {
    const mod = await freshModule();
    const first = mod.loadTurnstileScript();
    const failedScript = scriptTag();
    failedScript!.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow(/Failed to load Turnstile/);

    // A retry (same module instance) must not just replay the cached
    // rejection — it should attempt a fresh load.
    failedScript!.remove();
    const second = mod.loadTurnstileScript();
    const retryScript = scriptTag();
    expect(retryScript).not.toBeNull();
    expect(retryScript).not.toBe(failedScript);
    retryScript!.dispatchEvent(new Event("load"));
    await expect(second).resolves.toBeUndefined();
  });
});

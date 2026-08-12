import { renderHook, act, waitFor } from "@testing-library/react";
import { useLeadSubmit } from "../useLeadSubmit";
import * as metaPixel from "../../lib/metaPixel";

function mockFetch(ok: boolean, body: unknown = { ok }) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("useLeadSubmit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    document.cookie.split(";").forEach((c) => {
      const name = c.split("=")[0]?.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });
  });

  it("posts event_id on every submit, with no fbc/fbp when neither is present", async () => {
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useLeadSubmit("waitlist"));

    await act(async () => {
      await result.current.submit({ email: "a@b.co", source: "waitlist" });
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(typeof body.event_id).toBe("string");
    expect(body.event_id.length).toBeGreaterThan(0);
    expect(body.fbc).toBeUndefined();
    expect(body.fbp).toBeUndefined();
  });

  it("forwards fbc (derived from a URL fbclid) and fbp (from the _fbp cookie)", async () => {
    window.history.replaceState({}, "", "/?fbclid=click123");
    document.cookie = "_fbp=fb.1.1690000000000.999888777";
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useLeadSubmit("waitlist"));

    await act(async () => {
      await result.current.submit({ email: "a@b.co", source: "waitlist" });
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.fbc).toMatch(/^fb\.1\.\d+\.click123$/);
    expect(body.fbp).toBe("fb.1.1690000000000.999888777");
  });

  it("fires trackLead with the same event_id on a successful submit", async () => {
    const trackLeadSpy = vi.spyOn(metaPixel, "trackLead");
    vi.stubGlobal("fetch", mockFetch(true));
    const { result } = renderHook(() => useLeadSubmit("waitlist"));

    await act(async () => {
      await result.current.submit({ email: "a@b.co", source: "waitlist" });
    });

    expect(trackLeadSpy).toHaveBeenCalledTimes(1);
    const eventId = trackLeadSpy.mock.calls[0][0];
    expect(typeof eventId).toBe("string");
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("does not fire trackLead when the server rejects", async () => {
    const trackLeadSpy = vi.spyOn(metaPixel, "trackLead");
    vi.stubGlobal("fetch", mockFetch(false, { ok: false }));
    const { result } = renderHook(() => useLeadSubmit("waitlist"));

    await act(async () => {
      await result.current.submit({ email: "a@b.co", source: "waitlist" });
    });

    expect(trackLeadSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("passes turnstileToken through untouched when the caller supplies one", async () => {
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useLeadSubmit("coach"));

    await act(async () => {
      await result.current.submit({
        name: "Sam",
        email: "sam@gym.co",
        turnstileToken: "tok_abc",
      });
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.turnstileToken).toBe("tok_abc");
  });
});

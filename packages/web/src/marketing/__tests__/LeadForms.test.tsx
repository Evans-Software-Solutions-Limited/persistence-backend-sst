import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { WaitlistForm, CoachEnquiryForm } from "../LeadForms";
import { isValidEmail } from "../useLeadSubmit";

function mockFetch(ok: boolean, body: unknown = { ok }) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("isValidEmail", () => {
  it("accepts a normal address and rejects garbage", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  a@b.co ")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("WaitlistForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks submit until email is valid AND consent is ticked", async () => {
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    renderPage(<WaitlistForm />);

    const submit = screen.getByText("Notify me at launch");
    // No email, no consent → clicking shows validation, never calls fetch.
    fireEvent.click(submit);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "me@example.com" },
    });
    // Email valid but consent still unchecked → still blocked.
    fireEvent.click(submit);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/tick the box/i)).toBeDefined();
  });

  it("posts to /leads/waitlist and shows success", async () => {
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    renderPage(<WaitlistForm />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Notify me at launch"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/leads\/waitlist$/);
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "me@example.com",
      source: "waitlist",
    });
    await waitFor(() => expect(screen.getByText(/on the list/i)).toBeDefined());
  });

  it("surfaces a retry message when the server rejects", async () => {
    vi.stubGlobal("fetch", mockFetch(false, { ok: false }));
    renderPage(<WaitlistForm />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Notify me at launch"));
    await waitFor(() => expect(screen.getByText(/went wrong/i)).toBeDefined());
  });
});

describe("Turnstile widget", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.head
      .querySelectorAll('script[src*="challenges.cloudflare.com"]')
      .forEach((el) => el.remove());
  });

  it("renders no widget and submit still works when no site key is configured", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = renderPage(<WaitlistForm />);

    expect(container.querySelector(".lead-turnstile")).toBeNull();
    expect(
      document.head.querySelector('script[src*="challenges.cloudflare.com"]'),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Notify me at launch"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body as string).turnstileToken).toBeUndefined();
  });

  it("renders a container and lazily loads the challenge script when a site key is configured", () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
    const { container } = renderPage(<WaitlistForm />);

    expect(container.querySelector(".lead-turnstile")).not.toBeNull();
    expect(
      document.head.querySelector('script[src*="challenges.cloudflare.com"]'),
    ).not.toBeNull();
  });

  describe("with window.turnstile mocked (script already loaded)", () => {
    let renderMock: ReturnType<typeof vi.fn>;
    let resetMock: ReturnType<typeof vi.fn>;
    let capturedOptions:
      | {
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
        }
      | undefined;

    beforeEach(() => {
      capturedOptions = undefined;
      renderMock = vi.fn((_el: HTMLElement, opts: typeof capturedOptions) => {
        capturedOptions = opts;
        return "widget-1";
      });
      resetMock = vi.fn();
      (window as unknown as { turnstile?: unknown }).turnstile = {
        render: renderMock,
        remove: vi.fn(),
        reset: resetMock,
      };
    });

    afterEach(() => {
      delete (window as unknown as { turnstile?: unknown }).turnstile;
    });

    it("resets the widget and clears the token after a failed submit, so a retry doesn't resend the consumed token", async () => {
      vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
      const fetchSpy = mockFetch(false, { ok: false });
      vi.stubGlobal("fetch", fetchSpy);
      renderPage(<WaitlistForm />);

      await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
      capturedOptions!.callback!("tok-first");

      fireEvent.change(screen.getByLabelText("Email address"), {
        target: { value: "me@example.com" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByText("Notify me at launch"));

      await waitFor(() => expect(screen.getByText(/went wrong/i)).toBeDefined());
      expect(resetMock).toHaveBeenCalledWith("widget-1");

      // Retry without solving a new challenge — the already-consumed token
      // must not be resent.
      fireEvent.click(screen.getByText("Notify me at launch"));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      const [, secondInit] = fetchSpy.mock.calls[1];
      expect(
        JSON.parse(secondInit.body as string).turnstileToken,
      ).toBeUndefined();
    });

    it("does not reset the widget after a successful submit", async () => {
      vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
      vi.stubGlobal("fetch", mockFetch(true));
      renderPage(<WaitlistForm />);

      await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
      capturedOptions!.callback!("tok-first");

      fireEvent.change(screen.getByLabelText("Email address"), {
        target: { value: "me@example.com" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByText("Notify me at launch"));

      await waitFor(() => expect(screen.getByText(/on the list/i)).toBeDefined());
      expect(resetMock).not.toHaveBeenCalled();
    });

    it("clears the token when Turnstile reports the challenge expired, so a stale token is never sent", async () => {
      vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
      const fetchSpy = mockFetch(true);
      vi.stubGlobal("fetch", fetchSpy);
      renderPage(<WaitlistForm />);

      await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
      capturedOptions!.callback!("tok-first");
      capturedOptions!["expired-callback"]!();

      fireEvent.change(screen.getByLabelText("Email address"), {
        target: { value: "me@example.com" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByText("Notify me at launch"));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const [, init] = fetchSpy.mock.calls[0];
      expect(JSON.parse(init.body as string).turnstileToken).toBeUndefined();
    });
  });
});

describe("CoachEnquiryForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires name + email + consent, then posts the structured fields", async () => {
    const fetchSpy = mockFetch(true);
    vi.stubGlobal("fetch", fetchSpy);
    renderPage(<CoachEnquiryForm />);

    fireEvent.click(screen.getByText("Register your interest"));
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Sam Coach" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "sam@gym.co" },
    });
    fireEvent.change(screen.getByLabelText(/how many clients/i), {
      target: { value: "21-50" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Register your interest"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/leads\/coach$/);
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "Sam Coach",
      email: "sam@gym.co",
      clientCount: "21-50",
    });
    await waitFor(() => expect(screen.getByText(/be in touch/i)).toBeDefined());
  });
});

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

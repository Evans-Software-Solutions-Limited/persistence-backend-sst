import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { FoundingClaimContainer } from "@/ui/containers/FoundingClaimContainer";

function setup() {
  const api = new InMemoryApiAdapter();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  queryClient.setQueryData(["user-subscription", "apple-relay-user"], {
    tierName: "free",
  });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <AdapterProvider
        adapters={{
          api,
          auth: new InMemoryAuthAdapter(),
          storage: new InMemoryStorageAdapter(),
          health: new StubHealthAdapter(),
          notifications: new StubNotificationsAdapter(),
          netInfo: new InMemoryNetInfoAdapter(),
        }}
      >
        <FoundingClaimContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
  fireEvent.press(screen.getByTestId("founding-claim-toggle"));
  return { api, queryClient, invalidate };
}

async function requestCode() {
  fireEvent.changeText(
    screen.getByTestId("founding-claim-email"),
    " Original@Example.com ",
  );
  fireEvent.press(screen.getByTestId("founding-claim-submit"));
  await screen.findByTestId("founding-claim-code");
}

describe("FoundingClaimContainer", () => {
  it("verifies access at the original email and refreshes entitlement queries", async () => {
    const { api, queryClient, invalidate } = setup();
    expect(screen.getByText(/Apple Hide My Email/)).toBeTruthy();
    expect(
      screen.getByTestId("founding-claim-submit").props.accessibilityState
        .disabled,
    ).toBe(true);
    await requestCode();
    expect(api.foundingClaimRequests).toEqual(["original@example.com"]);
    expect(
      screen.getByText(/verify ownership and check for unclaimed access/),
    ).toBeTruthy();
    expect(
      screen.getByTestId("founding-claim-submit").props.accessibilityState
        .disabled,
    ).toBe(true);
    fireEvent.changeText(screen.getByTestId("founding-claim-code"), "01a23456");
    fireEvent.press(screen.getByTestId("founding-claim-submit"));
    await screen.findByText("Your existing access is now active.");
    expect(api.foundingClaimVerifications).toEqual([
      { challengeId: "11111111-1111-4111-8111-111111111111", code: "012345" },
    ]);
    expect(
      queryClient.getQueryState(["user-subscription", "apple-relay-user"])
        ?.isInvalidated,
    ).toBe(true);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([
        ["user-subscription"],
        ["user-profile"],
        ["profile-data"],
      ]),
    );
  });

  it("keeps the email form after a send failure and clears errors when corrected", async () => {
    const { api } = setup();
    api.shouldFail = true;
    fireEvent.changeText(
      screen.getByTestId("founding-claim-email"),
      "original@example.com",
    );
    fireEvent.press(screen.getByTestId("founding-claim-submit"));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("founding-claim-code")).toBeNull();
    fireEvent.changeText(
      screen.getByTestId("founding-claim-email"),
      "other@example.com",
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("retains verification state on failure, permits resend, and can change email", async () => {
    const { api, invalidate } = setup();
    await requestCode();
    api.shouldFail = true;
    fireEvent.changeText(screen.getByTestId("founding-claim-code"), "123456");
    fireEvent.press(screen.getByTestId("founding-claim-submit"));
    await screen.findByRole("alert");
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByTestId("founding-claim-code").props.value).toBe(
      "123456",
    );
    api.shouldFail = false;
    fireEvent.press(screen.getByText("Resend code"));
    await waitFor(() =>
      expect(screen.getByTestId("founding-claim-code").props.value).toBe(""),
    );
    expect(api.foundingClaimRequests).toHaveLength(2);
    fireEvent.press(screen.getByText("Use another email"));
    expect(screen.getByTestId("founding-claim-email")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

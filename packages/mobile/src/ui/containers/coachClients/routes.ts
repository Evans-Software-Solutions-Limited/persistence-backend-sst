import type { SetupSection } from "@/domain/models/coachClientProfiles";

/**
 * PER-125: where the add-client screens live (`app/(app)/coach-clients/`).
 * The add flow (Who → Set up → Invite) replaces one step with the next, so
 * Back from the flow always lands on Clients.
 */
export type ClientFlow = "add" | "edit";

export const coachClientRoutes = {
  add: () => ({ pathname: "/(app)/coach-clients/add" }) as const,
  who: (profileId: string, flow: ClientFlow) =>
    ({
      pathname: "/(app)/coach-clients/[profileId]/who",
      params: { profileId, flow },
    }) as const,
  setup: (profileId: string, flow: ClientFlow) =>
    ({
      pathname: "/(app)/coach-clients/[profileId]/setup",
      params: { profileId, flow },
    }) as const,
  section: (profileId: string, section: SetupSection) =>
    ({
      pathname: "/(app)/coach-clients/[profileId]/section",
      params: { profileId, section },
    }) as const,
  preview: (profileId: string) =>
    ({
      pathname: "/(app)/coach-clients/[profileId]/preview",
      params: { profileId },
    }) as const,
  invite: (profileId: string) =>
    ({
      pathname: "/(app)/coach-clients/[profileId]/invite",
      params: { profileId },
    }) as const,
  invited: (profileId: string) =>
    ({
      pathname: "/(app)/coach-clients/[profileId]",
      params: { profileId },
    }) as const,
};

export function flowOf(value: unknown): ClientFlow {
  return value === "add" ? "add" : "edit";
}

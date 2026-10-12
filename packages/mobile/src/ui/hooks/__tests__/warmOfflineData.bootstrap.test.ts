import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  forgetBootstrapSections,
  rememberBootstrapSection,
} from "@/application/bootstrap/freshness";
import { warmOfflineData } from "@/ui/hooks/useOfflineDataBootstrap";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const USER = "u-warm";
afterEach(() => forgetBootstrapSections(USER));

it("skips the Progress reads the cold-start bootstrap already wrote", async () => {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const spies = {
    streaks: jest.spyOn(api, "getStreaks"),
    achievements: jest.spyOn(api, "getAchievements"),
    volumeStats: jest.spyOn(api, "getVolumeStats"),
    bodyTrend: jest.spyOn(api, "getBodyTrend"),
    recentPRs: jest.spyOn(api, "getRecentPRs"),
  } as const;
  for (const section of Object.keys(spies) as (keyof typeof spies)[])
    rememberBootstrapSection(USER, section, Date.now());
  await warmOfflineData({
    api,
    auth: new InMemoryAuthAdapter(),
    storage,
    userId: USER,
  });
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  forgetBootstrapSections(USER);
  await warmOfflineData({
    api,
    auth: new InMemoryAuthAdapter(),
    storage,
    userId: USER,
  });
  for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
});

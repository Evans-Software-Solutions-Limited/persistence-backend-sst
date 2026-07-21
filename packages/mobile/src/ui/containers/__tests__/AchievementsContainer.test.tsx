import { act, render } from "@testing-library/react-native";
import type { CachedResourceState } from "@/ui/hooks/useCachedResource";
import type { Achievement } from "@/domain/models/achievement";
import type { PersonalRecord } from "@/domain/models/record";
import type { AchievementsPresenterProps } from "@/ui/presenters/AchievementsPresenter";
import { AchievementsContainer } from "../AchievementsContainer";

/**
 * <AchievementsContainer> tests — mirrors CoachHomeContainer.test.tsx's
 * hook-mocking convention: mock the data hooks, capture the props handed to
 * the (mocked) presenter, and assert the wiring rather than re-testing the
 * presenter's own rendering (covered by AchievementsPresenter.test.tsx).
 */

const mockProbe: { last: AchievementsPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/AchievementsPresenter", () => ({
  AchievementsPresenter: (props: AchievementsPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

let mockAchievementsState: CachedResourceState<Achievement[]>;
let mockPRsState: CachedResourceState<PersonalRecord[]>;
let mockProfileWeightUnit: "kg" | "lb" | undefined;

jest.mock("@/ui/hooks/useGetAchievements", () => ({
  useGetAchievements: () => mockAchievementsState,
}));
jest.mock("@/ui/hooks/useGetPRHistory", () => ({
  useGetPRHistory: () => mockPRsState,
}));
jest.mock("@/ui/hooks/useProfilePage", () => ({
  useProfilePage: () => ({
    payload: mockProfileWeightUnit
      ? { profile: { weightUnit: mockProfileWeightUnit } }
      : null,
  }),
}));

function cached<T>(
  over: Partial<CachedResourceState<T>>,
): CachedResourceState<T> {
  return {
    data: null,
    isStale: false,
    isRefreshing: false,
    error: null,
    refresh: jest.fn(async () => {}),
    reload: jest.fn(),
    ...over,
  } as CachedResourceState<T>;
}

function achievement(over: Partial<Achievement> = {}): Achievement {
  return {
    id: "ua1",
    achievementId: "a1",
    name: "Workout Streak — 4 weeks",
    description: "Trained 4 weeks in a row.",
    category: "streak",
    requirements: { streak_type: "workout_streak", threshold: 4 },
    unlockedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function pr(over: Partial<PersonalRecord> = {}): PersonalRecord {
  return {
    id: "pr1",
    userId: "u1",
    exerciseId: "e1",
    exerciseName: "Bench Press",
    recordType: "1rm",
    value: 85,
    achievedAt: "2026-06-06T00:00:00.000Z",
    sessionId: null,
    setId: null,
    ...over,
  };
}

beforeEach(() => {
  mockProbe.last = null;
  mockProfileWeightUnit = undefined;
  mockAchievementsState = cached<Achievement[]>({ data: null });
  mockPRsState = cached<PersonalRecord[]>({ data: null });
});

describe("AchievementsContainer", () => {
  it("maps achievements into milestone tiers + passes the raw list + earnedCount through", () => {
    mockAchievementsState = cached<Achievement[]>({
      data: [achievement()],
    });
    render(<AchievementsContainer />);

    expect(mockProbe.last?.achievements).toEqual([achievement()]);
    expect(mockProbe.last?.milestones).toHaveLength(5);
    expect(
      mockProbe.last?.milestones.find((t) => t.label === "4w")?.earned,
    ).toBe(true);
    expect(mockProbe.last?.earnedCount).toBe(1);
  });

  it("passes the PR history through and defaults weightUnit to kg", () => {
    mockPRsState = cached<PersonalRecord[]>({ data: [pr()] });
    render(<AchievementsContainer />);

    expect(mockProbe.last?.prHistory).toEqual([pr()]);
    expect(mockProbe.last?.weightUnit).toBe("kg");
  });

  it("forwards the profile's weightUnit preference when present", () => {
    mockProfileWeightUnit = "lb";
    render(<AchievementsContainer />);
    expect(mockProbe.last?.weightUnit).toBe("lb");
  });

  it("is loading only while both sources are stale with no data at all", () => {
    mockAchievementsState = cached<Achievement[]>({
      data: null,
      isStale: true,
      isRefreshing: true,
    });
    mockPRsState = cached<PersonalRecord[]>({ data: null });
    render(<AchievementsContainer />);
    expect(mockProbe.last?.isLoading).toBe(true);
  });

  it("is not loading once achievements has data, even if PRs are still empty", () => {
    mockAchievementsState = cached<Achievement[]>({
      data: [],
      isRefreshing: true,
    });
    mockPRsState = cached<PersonalRecord[]>({ data: null });
    render(<AchievementsContainer />);
    expect(mockProbe.last?.isLoading).toBe(false);
  });

  it("surfaces the achievements error only while achievements has no data", () => {
    const error = {
      kind: "api" as const,
      code: "network" as const,
      message: "offline",
    };
    mockAchievementsState = cached<Achievement[]>({ data: null, error });
    render(<AchievementsContainer />);
    expect(mockProbe.last?.error).toEqual(error);

    mockAchievementsState = cached<Achievement[]>({ data: [], error });
    render(<AchievementsContainer />);
    expect(mockProbe.last?.error).toBeNull();
  });

  it("onRefresh refreshes both achievements and PR history", () => {
    const refreshAchievements = jest.fn(async () => {});
    const refreshPRs = jest.fn(async () => {});
    mockAchievementsState = cached<Achievement[]>({
      refresh: refreshAchievements,
    });
    mockPRsState = cached<PersonalRecord[]>({ refresh: refreshPRs });
    render(<AchievementsContainer />);

    act(() => {
      mockProbe.last?.onRefresh();
    });
    expect(refreshAchievements).toHaveBeenCalled();
    expect(refreshPRs).toHaveBeenCalled();
  });
});

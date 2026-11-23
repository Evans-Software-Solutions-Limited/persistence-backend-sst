import { act, render, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Streak } from "@/domain/models/streak";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecapPresenterProps } from "@/ui/presenters/RecapPresenter";
import { buildRecap, recapWindow } from "@/domain/services/youPage";
import {
  musclesOf,
  record,
  session as finished,
} from "@/domain/services/__tests__/youFixtures";
import type { YouRemoteSource } from "@/application/queries/youRemote";
import type { RemoteRecap } from "@/domain/models/trainingReads";
import {
  RecapContainer,
  comparison,
  periodLabel,
  recapPages,
  recapShareText,
  streakText,
} from "../RecapContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  router: { back: () => mockBack() },
  useFocusEffect: () => {},
  useRouter: () => ({ back: mockBack }),
}));
const mockProbe: { last: RecapPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/RecapPresenter", () => ({
  RecapPresenter: (props: RecapPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));
(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: [] }),
}));

const NOW = new Date(2026, 9, 29, 18);
const at = (d: number, m = 9) => new Date(2026, m, d, 7).toISOString();

describe("recap wording", () => {
  it("names the period", () => {
    expect(periodLabel("week", NOW)).toBe("This week");
    expect(periodLabel("month", NOW)).toBe("October");
    expect(periodLabel("3months", NOW)).toBe("Aug – Oct");
  });

  it("compares with the period before", () => {
    const base = buildRecap({
      period: "week",
      now: NOW,
      sessions: [],
      records: [],
      musclesOf,
    });
    const withTotals = (
      period: "week" | "month" | "3months",
      cur: number,
      prev: number,
      vol = 0,
      pvol = 0,
    ) =>
      comparison(
        {
          ...base,
          period,
          totals: { ...base.totals, workouts: cur, volumeKg: vol },
          previous: { ...base.previous, workouts: prev, volumeKg: pvol },
        },
        NOW,
      );
    expect(withTotals("week", 4, 3)).toBe("1 more than last week");
    expect(withTotals("month", 12, 14)).toBe("2 fewer than September");
    expect(withTotals("week", 2, 2)).toBe("Same as last week");
    expect(withTotals("3months", 0, 0, 1110, 1000)).toBe(
      "+11% volume vs the 3 months before",
    );
    expect(withTotals("3months", 0, 0, 900, 1000)).toBe(
      "−10% volume vs the 3 months before",
    );
    expect(withTotals("3months", 0, 0, 900, 0)).toBe("");
  });

  it("reads the workout streak", () => {
    const s = (over: Partial<Streak>) =>
      ({
        streakType: "workout_streak",
        period: "weekly",
        currentCount: 6,
        ...over,
      }) as Streak;
    expect(streakText([s({})])).toBe("6 wk");
    expect(
      streakText([
        s({
          streakType: "habit_streak" as never,
          period: "daily",
          currentCount: 3,
        }),
      ]),
    ).toBe("3 d");
    expect(streakText([])).toBe("—");
  });
});

describe("recapPages", () => {
  const week = finished(
    "a",
    at(27),
    {
      squat: [
        [100, 5],
        [100, 5],
      ],
      bench: [[80, 5]],
    },
    { together: { sessionId: "t", executionId: "x" } },
  );

  it("builds every page that has data, in canvas order", () => {
    const model = buildRecap({
      period: "week",
      now: NOW,
      sessions: [week],
      records: [
        record("squat", at(27), { exerciseName: "Squat", value: 120 }),
        record("bench", at(28), {
          exerciseName: "Bench",
          recordType: "max_reps",
          value: 12,
        }),
      ],
      musclesOf,
      partners: new Map([["a", ["Tom", "Priya"]]]),
    });
    const pages = recapPages(model, { now: NOW, unit: "kg", streak: "6 wk" });
    expect(pages.map((p) => p.id)).toEqual([
      "totals",
      "muscles",
      "lifts",
      "volume",
      "records",
      "together",
    ]);
    const [totals, muscles, lifts, volume, records, together] =
      pages as unknown as [
        Extract<(typeof pages)[number], { kind: "big" }>,
        Extract<(typeof pages)[number], { kind: "muscles" }>,
        Extract<(typeof pages)[number], { kind: "list" }>,
        Extract<(typeof pages)[number], { kind: "big" }>,
        Extract<(typeof pages)[number], { kind: "big" }>,
        Extract<(typeof pages)[number], { kind: "big" }>,
      ];
    expect(totals).toMatchObject({
      big: "1",
      unit: "workouts",
      eyebrow: "This week",
      sub: "1 more than last week",
    });
    expect(totals.trio.map((t) => t.value)).toEqual([
      "1.4 t",
      "1h 00m",
      "6 wk",
    ]);
    expect(muscles.eyebrow).toBe("This week · muscle balance");
    expect(muscles.rows[0]!.label).toBe("Quads");
    expect(muscles.shading.accessibilityLabel).toMatch(
      /^Muscle balance: Quads/,
    );
    expect(lifts.lifts).toHaveLength(2);
    expect(volume).toMatchObject({
      big: "1.4",
      unit: "t",
      sub: "Most on Squat",
    });
    expect(records).toMatchObject({ big: "2", unit: "PRs", gold: true });
    expect(records.trio.map((t) => t.value)).toEqual(["12", "120"]);
    expect(together).toMatchObject({
      big: "1",
      unit: "session",
      sub: "With Tom and Priya",
    });
  });

  it("is only the totals page for a new user", () => {
    const model = buildRecap({
      period: "month",
      now: NOW,
      sessions: [],
      records: [],
      musclesOf,
    });
    const pages = recapPages(model, { now: NOW, unit: "lb", streak: "—" });
    expect(pages.map((p) => p.id)).toEqual(["totals"]);
    expect(pages[0]).toMatchObject({
      big: "0",
      eyebrow: "October",
      sub: "Same as September",
    });
  });

  it("single record and a Together session without names", () => {
    const model = buildRecap({
      period: "week",
      now: NOW,
      sessions: [week],
      records: [record("squat", at(27), { exerciseName: "Squat", value: 120 })],
      musclesOf,
    });
    const pages = recapPages(model, { now: NOW, unit: "kg", streak: "—" });
    expect(pages.find((p) => p.id === "records")).toMatchObject({ unit: "PR" });
    expect(pages.find((p) => p.id === "together")).toMatchObject({ sub: "" });
  });

  it("leaves the comparison out when told the period before is part-kept", () => {
    const model = buildRecap({
      period: "week",
      now: NOW,
      sessions: [week],
      records: [],
      musclesOf,
    });
    expect(
      recapPages(model, {
        now: NOW,
        unit: "kg",
        streak: "—",
        compare: false,
      })[0],
    ).toMatchObject({ sub: "" });
    expect(
      recapPages(model, {
        now: NOW,
        unit: "kg",
        streak: "—",
        compare: true,
      })[0],
    ).toMatchObject({ sub: "1 more than last week" });
  });

  it("shows each record in its own unit (Inspector Brad #541)", () => {
    const model = buildRecap({
      period: "week",
      now: NOW,
      sessions: [],
      records: [
        record("run", at(27), { recordType: "best_time", value: 95 }),
        record("row", at(27), { recordType: "longest_distance", value: 2000 }),
        record("squat", at(27), { recordType: "1rm", value: 100 }),
      ],
      musclesOf,
    });
    const page = recapPages(model, { now: NOW, unit: "lb", streak: "—" }).find(
      (p) => p.id === "records",
    ) as unknown as { trio: { value: string }[] };
    expect(page.trio.map((t) => t.value).sort()).toEqual(
      ["1:35", "2,000", "220.5"].sort(),
    );
  });

  it("shares each kind of page as text", () => {
    const model = buildRecap({
      period: "week",
      now: NOW,
      sessions: [week],
      records: [],
      musclesOf,
    });
    const pages = recapPages(model, { now: NOW, unit: "kg", streak: "6 wk" });
    expect(recapShareText(pages[0]!)).toBe(
      "Persistence · This week\n1 workouts\n1 more than last week\nVolume: 1.4 t\nTime: 1h 00m\nStreak: 6 wk",
    );
    expect(recapShareText(pages.find((p) => p.id === "muscles")!)).toMatch(
      /^Persistence · This week · muscle balance\nQuads \d+%/,
    );
    expect(recapShareText(pages.find((p) => p.id === "lifts")!)).toMatch(
      /^Persistence · This week · top lifts\n1\. Squat/,
    );
  });
});

function makeAdapters() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "alex@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      netInfo: {} as Adapters["netInfo"],
    } as Adapters,
  };
}

describe("RecapContainer", () => {
  it("builds this week from the log, switches period, shares and closes", async () => {
    const { storage, adapters } = makeAdapters();
    storage.saveTrainingLogEntry(
      "user-1",
      finished("a", new Date().toISOString(), { bench: [[100, 5]] }),
    );
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(),
      recap: jest.fn(async () => ({ status: "unavailable" as const })),
      lastSevenDays: jest.fn(),
    };
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    render(
      <AdapterProvider adapters={adapters}>
        <RecapContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last!.period).toBe("week");
    expect(mockProbe.last!.pages[0]).toMatchObject({ id: "totals", big: "1" });
    // The log only started today, so the BE-H1 seam is asked and can't help.
    await waitFor(() =>
      expect(mockProbe.last!.coverageNote).toMatch(
        /^From .*, when this phone started keeping your history\.$/,
      ),
    );
    expect(remote.recap).toHaveBeenCalledWith("week");
    act(() => mockProbe.last!.onPeriod("3months"));
    await waitFor(() => expect(mockProbe.last!.period).toBe("3months"));
    await waitFor(() => expect(remote.recap).toHaveBeenCalledWith("3months"));
    act(() => mockProbe.last!.onShare(mockProbe.last!.pages[0]!));
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining("Persistence · "),
    });
    act(() => mockProbe.last!.onClose());
    expect(mockBack).toHaveBeenCalled();
    share.mockRestore();
  });

  it("compares only against a period before that the phone fully kept (Inspector Brad #541)", async () => {
    const { storage, adapters } = makeAdapters();
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(),
      recap: jest.fn(async () => ({ status: "unavailable" as const })),
      lastSevenDays: jest.fn(),
    };
    // The log started mid last week: this week is covered, last week isn't.
    const thisWeek = recapWindow("week", new Date()).from;
    storage.markTrainingLogSince(
      "user-1",
      new Date(thisWeek.getTime() - 2 * 86_400_000).toISOString(),
    );
    const r = render(
      <AdapterProvider adapters={adapters}>
        <RecapContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(remote.recap).toHaveBeenCalledWith("week"));
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last!.coverageNote).toBeNull();
    expect(mockProbe.last!.pages[0]).toMatchObject({ sub: "" });
    r.unmount();

    // A log kept long before both windows compares as normal.
    const { storage: s2, adapters: a2 } = makeAdapters();
    s2.markTrainingLogSince("user-1", "2020-01-01T00:00:00.000Z");
    mockProbe.last = null;
    render(
      <AdapterProvider adapters={a2}>
        <RecapContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last!.coverageNote).toBeNull();
    expect(mockProbe.last!.pages[0]).toMatchObject({
      sub: "Same as last week",
    });
  });

  const serverRecap = (workouts: number): RemoteRecap => ({
    period: "week",
    timezone: "Europe/London",
    from: "2026-11-16",
    to: "2026-11-22",
    previousFrom: "2026-11-09",
    previousTo: "2026-11-15",
    totals: { workouts, durationSeconds: 3600, volumeKg: 5000, sets: 20 },
    previous: { workouts: 1, durationSeconds: 1800, volumeKg: 1000, sets: 5 },
    muscles: [],
    lifts: [],
    volume: [],
    records: [
      {
        exerciseId: "bench",
        exerciseName: "Bench press",
        recordType: "1rm",
        value: 100,
        achievedAt: new Date().toISOString(),
        sessionId: null,
      },
    ],
    together: { sessions: 0, names: [] },
    asOf: new Date().toISOString(),
  });

  it("drops the coverage note and shows the server's recap once BE-H1 answers", async () => {
    const { adapters } = makeAdapters();
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(),
      recap: jest.fn(async () => ({
        status: "ok" as const,
        data: serverRecap(4),
      })),
      lastSevenDays: jest.fn(),
    };
    render(
      <AdapterProvider adapters={adapters}>
        <RecapContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(remote.recap).toHaveBeenCalled());
    await waitFor(() => expect(mockProbe.last!.coverageNote).toBeNull());
    await waitFor(() =>
      expect(mockProbe.last!.pages[0]).toMatchObject({
        id: "totals",
        big: "4",
      }),
    );
  });

  it("keeps the phone's recap when it holds workouts the server hasn't seen", async () => {
    const { storage, adapters } = makeAdapters();
    storage.saveTrainingLogEntry(
      "user-1",
      finished("a", new Date().toISOString(), { bench: [[100, 5]] }),
    );
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(),
      recap: jest.fn(async () => ({
        status: "ok" as const,
        data: serverRecap(0),
      })),
      lastSevenDays: jest.fn(),
    };
    render(
      <AdapterProvider adapters={adapters}>
        <RecapContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(remote.recap).toHaveBeenCalled());
    // Not used, so the page still says what the phone covers.
    await waitFor(() => expect(mockProbe.last!.coverageNote).toMatch(/^From /));
    expect(mockProbe.last!.pages[0]).toMatchObject({ big: "1" });
  });

  it("keeps the phone's recap while the server's, though bigger, lacks a workout the phone holds (Inspector Brad #545)", async () => {
    const { storage, adapters } = makeAdapters();
    storage.saveTrainingLogEntry(
      "user-1",
      finished("local-a", new Date().toISOString(), { bench: [[100, 5]] }),
    );
    const lacking = { ...serverRecap(3), sessionIds: ["s1", "s2", "s3"] };
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(),
      recap: jest.fn(async () => ({ status: "ok" as const, data: lacking })),
      lastSevenDays: jest.fn(),
    };
    const r = render(
      <AdapterProvider adapters={adapters}>
        <RecapContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(remote.recap).toHaveBeenCalled());
    // The server's answer wasn't used, so the page still says what the
    // phone covers and makes no comparison with a week it never held
    // (Inspector Brad #545, sweep 3).
    await waitFor(() =>
      expect(mockProbe.last!.coverageNote).toMatch(
        /^From .*, when this phone started keeping your history\.$/,
      ),
    );
    expect(mockProbe.last!.pages[0]).toMatchObject({ big: "1", sub: "" });
    r.unmount();

    // Once the server counts it, its fuller recap is shown.
    const holding = {
      ...serverRecap(4),
      sessionIds: ["s1", "s2", "s3", "local-a"],
    };
    const remote2: YouRemoteSource = {
      ...remote,
      recap: jest.fn(async () => ({ status: "ok" as const, data: holding })),
    };
    render(
      <AdapterProvider adapters={adapters}>
        <RecapContainer remote={remote2} />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(mockProbe.last!.pages[0]).toMatchObject({ big: "4" }),
    );
  });
});

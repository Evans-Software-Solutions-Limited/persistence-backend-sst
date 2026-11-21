import {
  MUSCLE_DISPLAY_GROUPS,
  MUSCLE_TO_GROUP,
  muscleCredit,
  shadeLevel,
  trainNextAndRest,
  WEEKLY_GUIDE,
  type MuscleCreditInput,
} from "../muscleCredit";

const row = (inputs: MuscleCreditInput[], group: string) =>
  muscleCredit(inputs).find((r) => r.group === group)!;

describe("muscleCredit (n3b_shade, design H)", () => {
  // [case, input, group, credit, hard sets]
  it.each<[string, MuscleCreditInput, string, number, number]>([
    [
      "primary gets 1.0 per set",
      { primary: ["chest"], secondary: [], completedSets: 4 },
      "chest",
      4,
      4,
    ],
    [
      "secondary gets 0.5 per set",
      { primary: ["chest"], secondary: ["triceps"], completedSets: 4 },
      "arms",
      2,
      0,
    ],
    [
      "two primaries in one group count once per set",
      { primary: ["biceps", "triceps"], secondary: [], completedSets: 3 },
      "arms",
      3,
      3,
    ],
    [
      "primary beats secondary in the same group",
      { primary: ["back"], secondary: ["lats"], completedSets: 3 },
      "back",
      3,
      3,
    ],
    [
      "secondary listed twice in a group still 0.5",
      { primary: [], secondary: ["lats", "traps"], completedSets: 2 },
      "back",
      1,
      0,
    ],
    [
      "hip flexors credit core",
      { primary: ["hip_flexors"], secondary: [], completedSets: 2 },
      "core",
      2,
      2,
    ],
    [
      "abductors and adductors credit glutes",
      { primary: ["adductors"], secondary: ["abductors"], completedSets: 2 },
      "glutes",
      2,
      2,
    ],
    [
      "no completed sets earn nothing",
      { primary: ["chest"], secondary: [], completedSets: 0 },
      "chest",
      0,
      0,
    ],
    [
      "unknown muscles earn nothing",
      { primary: ["neck"], secondary: [], completedSets: 3 },
      "chest",
      0,
      0,
    ],
  ])("%s", (_name, input, group, credit, hardSets) => {
    const r = row([input], group);
    expect(r.credit).toBe(credit);
    expect(r.hardSets).toBe(hardSets);
  });

  it("counts hard sets only where the group was primary (Brad, 21 Nov)", () => {
    const r = row(
      [
        { primary: ["quadriceps"], secondary: ["glutes"], completedSets: 4 },
        { primary: ["glutes"], secondary: [], completedSets: 3 },
      ],
      "glutes",
    );
    expect(r.credit).toBe(5);
    expect(r.hardSets).toBe(3);
  });

  it("shades by credit, so a secondary muscle still shades", () => {
    const r = row(
      [{ primary: ["chest"], secondary: ["triceps"], completedSets: 10 }],
      "arms",
    );
    expect(r.hardSets).toBe(0);
    expect(r.ratio).toBe(0.5);
    expect(r.level).toBe(3);
  });

  it("sums credit across exercises", () => {
    const r = row(
      [
        { primary: ["chest"], secondary: [], completedSets: 4 },
        { primary: ["shoulders"], secondary: ["chest"], completedSets: 4 },
      ],
      "chest",
    );
    expect(r.credit).toBe(6);
  });

  it("returns all ten groups in canvas order, untrained ones at 0", () => {
    const rows = muscleCredit([]);
    expect(rows.map((r) => r.group)).toEqual([...MUSCLE_DISPLAY_GROUPS]);
    expect(rows.every((r) => r.credit === 0 && r.share === 0)).toBe(true);
    expect(rows.every((r) => r.level === 0)).toBe(true);
  });

  it("uses a guide of 10 for majors and 6 for calves, core, forearms", () => {
    expect(WEEKLY_GUIDE.chest).toBe(10);
    expect(WEEKLY_GUIDE.quads).toBe(10);
    expect(WEEKLY_GUIDE.calves).toBe(6);
    expect(WEEKLY_GUIDE.core).toBe(6);
    expect(WEEKLY_GUIDE.forearms).toBe(6);
  });

  it("shades by sets ÷ weekly guide, capped at 1", () => {
    const rows = muscleCredit([
      { primary: ["chest"], secondary: [], completedSets: 5 },
      { primary: ["calves"], secondary: [], completedSets: 12 },
    ]);
    const chest = rows.find((r) => r.group === "chest")!;
    const calves = rows.find((r) => r.group === "calves")!;
    expect(chest.ratio).toBe(0.5);
    expect(chest.level).toBe(3);
    expect(calves.ratio).toBe(1);
    expect(calves.level).toBe(4);
  });

  it("gives each group's share of all credit", () => {
    const rows = muscleCredit([
      { primary: ["chest"], secondary: [], completedSets: 3 },
      { primary: ["back"], secondary: [], completedSets: 1 },
    ]);
    expect(rows.find((r) => r.group === "chest")!.share).toBe(75);
    expect(rows.find((r) => r.group === "back")!.share).toBe(25);
  });

  it("maps every app muscle to a display group", () => {
    for (const g of Object.values(MUSCLE_TO_GROUP))
      expect(MUSCLE_DISPLAY_GROUPS).toContain(g);
  });
});

describe("shadeLevel", () => {
  it.each([
    [0, 0],
    [-1, 0],
    [Number.NaN, 0],
    [0.1, 1],
    [0.25, 2],
    [0.49, 2],
    [0.5, 3],
    [0.99, 3],
    [1, 4],
  ])("%p → %p", (ratio, level) => {
    expect(shadeLevel(ratio)).toBe(level);
  });
});

describe("trainNextAndRest", () => {
  it("puts groups that hit their week in Rest, the rest in Train next", () => {
    const { trainNext, rest } = trainNextAndRest(
      muscleCredit([
        { primary: ["chest"], secondary: [], completedSets: 12 },
        { primary: ["back"], secondary: [], completedSets: 10 },
        { primary: ["hamstrings"], secondary: [], completedSets: 4 },
        { primary: ["core"], secondary: [], completedSets: 1 },
      ]),
    );
    expect(rest.map((r) => r.group)).toEqual(["chest", "back"]);
    // Least done first; untrained groups tie at 0 and keep canvas order.
    expect(trainNext.slice(0, 4).map((r) => r.group)).toEqual([
      "quads",
      "shoulders",
      "glutes",
      "arms",
    ]);
    expect(trainNext.map((r) => r.group)).toContain("hamstrings");
    expect(trainNext).toHaveLength(8);
  });

  it("has an empty Rest for a new user", () => {
    const { trainNext, rest } = trainNextAndRest(muscleCredit([]));
    expect(rest).toEqual([]);
    expect(trainNext).toHaveLength(10);
  });
});

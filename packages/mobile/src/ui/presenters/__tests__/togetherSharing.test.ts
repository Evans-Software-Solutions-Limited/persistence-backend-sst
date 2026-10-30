import {
  applySharingChange,
  cloudSharingBase,
  cloudSharingWrites,
  holds,
  nearbySharingBase,
  nearbySharingWrites,
  previousSummary,
  refusalFor,
  refusedCopy,
  sharingPeople,
  sharingState,
  type SharingBase,
} from "../togetherSharing";

const people = sharingPeople(
  [{ userId: "me" }, { userId: "b" }, { userId: "t" }, { userId: "i" }],
  "me",
  (id, seat) => ({ b: "Brad", t: "Tom" })[id] ?? `Athlete ${seat + 1}`,
);
const grant = (
  recipientId: string,
  numbers: boolean,
  prev: boolean,
  logging: boolean,
) => ({ ownerId: "me", recipientId, consent: { numbers, prev, logging } });

describe("sharingPeople", () => {
  it("leaves you out and keeps seat order, names and strip colours", () => {
    expect(people).toEqual([
      { userId: "b", name: "Brad", tone: "info" },
      { userId: "t", name: "Tom", tone: "success" },
      { userId: "i", name: "Athlete 4", tone: "gold" },
    ]);
  });
});

describe("switches for everyone", () => {
  const base: SharingBase = {
    numbers: false,
    logging: false,
    previous: { b: true, t: false, i: false },
  };
  it("reads previous values on while anyone is picked", () => {
    expect(sharingState(base, people).previous).toBe(true);
    expect(
      sharingState({ ...base, previous: {} }, people).recipients.map(
        (r) => r.on,
      ),
    ).toEqual([false, false, false]);
  });
  it("turns previous values on or off for everyone, and a chip for one", () => {
    expect(
      applySharingChange(base, people, { key: "previous", value: true })
        .previous,
    ).toEqual({ b: true, t: true, i: true });
    expect(
      applySharingChange(base, people, { recipient: "t", value: true })
        .previous,
    ).toEqual({ b: true, t: true, i: false });
    expect(
      applySharingChange(base, people, { key: "logging", value: true }),
    ).toMatchObject({ logging: true, numbers: false });
  });
  it("knows when grants already say what a change asked for", () => {
    expect(holds(base, people, { key: "numbers", value: false })).toBe(true);
    expect(holds(base, people, { key: "previous", value: true })).toBe(true);
    expect(holds(base, people, { recipient: "t", value: true })).toBe(false);
  });
  it("words a refusal by what went back", () => {
    expect(refusedCopy(refusalFor({ key: "logging", value: true }))).toBe(
      "Couldn’t turn on fill-in. The session didn’t accept it, so it’s switched back off.",
    );
    expect(refusedCopy(refusalFor({ recipient: "b", value: false }))).toBe(
      "Couldn’t turn off previous values. The session didn’t accept it, so it’s switched back on.",
    );
    expect(refusedCopy({ key: "numbers", wanted: true })).toContain(
      "your numbers",
    );
  });
  it("summarises previous values for the live card", () => {
    const summary = (previous: Record<string, boolean>) =>
      previousSummary(sharingState({ ...base, previous }, people));
    expect(summary({ b: true, t: true, i: true })).toBe(
      "Everyone in the session",
    );
    expect(summary({ b: true, t: true })).toBe("To Brad and Tom");
    expect(summary({})).toBe("Off");
  });
});

describe("Nearby grants", () => {
  // Brad and Tom hold numbers and fill-in; Inés joined later with none.
  const grants = [grant("b", true, true, true), grant("t", true, false, true)];
  it("reads a switch on while anyone holds the grant", () => {
    expect(nearbySharingBase(grants, "me", people)).toEqual({
      numbers: true,
      logging: true,
      previous: { b: true, t: false, i: false },
    });
    expect(nearbySharingBase([], "me", [])).toMatchObject({
      numbers: false,
      logging: false,
    });
  });
  it("shows a newcomer's default grant instead of hiding it behind Off", () => {
    // Numbers turned off for Brad in the session, then Inés joined and the
    // stored defaults granted her numbers.
    const after = [
      grant("b", false, false, false),
      grant("i", true, false, false),
    ];
    expect(nearbySharingBase(after, "me", people).numbers).toBe(true);
  });
  it("turns a switch off or on for everyone", () => {
    const before = nearbySharingBase(grants, "me", people);
    expect(
      nearbySharingWrites(
        grants,
        "me",
        people,
        { ...before, numbers: false },
        before,
      ),
    ).toEqual([
      {
        recipientId: "b",
        consent: { numbers: false, prev: true, logging: true },
      },
      {
        recipientId: "t",
        consent: { numbers: false, prev: false, logging: true },
      },
    ]);
    const off = { ...before, logging: false, numbers: false };
    expect(
      nearbySharingWrites([], "me", people, { ...off, logging: true }, off).map(
        (w) => w.recipientId,
      ),
    ).toEqual(["b", "t", "i"]);
  });
  it("a chip changes only that person's previous values, never anyone's numbers", () => {
    const before = nearbySharingBase(grants, "me", people);
    expect(
      nearbySharingWrites(
        grants,
        "me",
        people,
        { ...before, previous: { ...before.previous, i: true } },
        before,
      ),
    ).toEqual([
      {
        recipientId: "i",
        consent: { numbers: false, prev: true, logging: false },
      },
    ]);
  });
});

describe("Online consent", () => {
  const own = {
    allowPartnerLogging: true,
    numbersConsent: { recipientIds: ["b", "gone"] },
    previousConsent: { recipientIds: ["t", "gone"] },
  };
  it("reads a switch on while anyone holds the grant", () => {
    expect(cloudSharingBase(own, people)).toEqual({
      numbers: true,
      logging: true,
      previous: { b: false, t: true, i: false },
    });
    expect(cloudSharingBase({ allowPartnerLogging: false }, [])).toMatchObject({
      numbers: false,
      previous: {},
    });
  });
  it("sends only what the tap changed", () => {
    const before = cloudSharingBase(own, people);
    // A chip: previous values for Inés, nobody's numbers rewritten.
    expect(
      cloudSharingWrites(
        own,
        people,
        { ...before, previous: { ...before.previous, i: true } },
        before,
      ),
    ).toEqual({ previous: ["t", "i"] });
    // Numbers off revokes everyone; fill-in is one flag.
    expect(
      cloudSharingWrites(own, people, { ...before, numbers: false }, before),
    ).toEqual({ numbers: [] });
    expect(
      cloudSharingWrites(own, people, { ...before, logging: false }, before),
    ).toEqual({ logging: false });
    const none = cloudSharingBase({ allowPartnerLogging: false }, people);
    expect(
      cloudSharingWrites(
        { allowPartnerLogging: false },
        people,
        { ...none, numbers: true },
        none,
      ),
    ).toEqual({ numbers: ["b", "t", "i"] });
  });
  it("never re-grants fill-in the server dropped when a partner joined, on an unrelated tap (inspector lead)", () => {
    // Shown from a held optimistic base: fill-in on. Meanwhile a partner was
    // admitted and the server turned fill-in off for everyone already in.
    const shown = cloudSharingBase(own, people);
    const server = { ...own, allowPartnerLogging: false };
    expect(
      cloudSharingWrites(
        server,
        people,
        { ...shown, previous: { ...shown.previous, i: true } },
        shown,
      ),
    ).toEqual({ previous: ["t", "i"] });
    // Tapping fill-in itself still sends it.
    const off = { ...shown, logging: false };
    expect(
      cloudSharingWrites(server, people, { ...off, logging: true }, off),
    ).toEqual({ logging: true });
  });
});

describe("partners who have finished (Online)", () => {
  // Tom finished his workout but is still in the roster.
  const roster = sharingPeople(
    [
      { userId: "me", status: "active" },
      { userId: "b", status: "active" },
      { userId: "t", status: "saved" },
      { userId: "i", status: "active" },
    ],
    "me",
    (id) => id,
  );
  it("keeps their strip colour but gives them no chip", () => {
    expect(roster.map((p) => [p.userId, p.tone, !!p.finished])).toEqual([
      ["b", "info", false],
      ["t", "success", true],
      ["i", "gold", false],
    ]);
    const state = sharingState(
      { numbers: false, logging: false, previous: { t: true } },
      roster,
    );
    expect(state.recipients.map((r) => r.userId)).toEqual(["b", "i"]);
    // Tom still holds it, so the switch says so.
    expect(state.previous).toBe(true);
  });
  it("leaves them out of anything turned on, so the server accepts it", () => {
    const own = {
      allowPartnerLogging: false,
      numbersConsent: { recipientIds: [] },
      previousConsent: { recipientIds: ["t"] },
    };
    const before = cloudSharingBase(own, roster);
    expect(
      cloudSharingWrites(own, roster, { ...before, numbers: true }, before),
    ).toEqual({ numbers: ["b", "i"] });
    const on = applySharingChange({ ...before, previous: {} }, roster, {
      key: "previous",
      value: true,
    });
    expect(on.previous).toEqual({ b: true, t: false, i: true });
    // A chip for Inés: the list sent names only partners still training.
    expect(
      cloudSharingWrites(
        own,
        roster,
        { ...before, previous: { ...before.previous, i: true } },
        before,
      ),
    ).toEqual({ previous: ["i"] });
  });
});

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
  const grants = [grant("b", true, true, true), grant("t", true, false, true)];
  it("reads the switches from every partner's grant", () => {
    expect(nearbySharingBase(grants, "me", people)).toEqual({
      numbers: false,
      logging: false,
      previous: { b: true, t: false, i: false },
    });
    expect(nearbySharingBase(grants, "me", people.slice(0, 2))).toMatchObject({
      numbers: true,
      logging: true,
    });
    expect(nearbySharingBase([], "me", [])).toMatchObject({
      numbers: false,
      logging: false,
    });
  });
  it("writes only the grants that change", () => {
    expect(
      nearbySharingWrites(grants, "me", people, {
        numbers: true,
        logging: true,
        previous: { b: true },
      }),
    ).toEqual([
      {
        recipientId: "i",
        consent: { numbers: true, prev: false, logging: true },
      },
    ]);
  });
});

describe("Online consent", () => {
  const own = {
    allowPartnerLogging: true,
    numbersConsent: { recipientIds: ["b", "t", "i", "gone"] },
    previousConsent: { recipientIds: ["t"] },
  };
  it("reads the switches from the recipient lists", () => {
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
  it("sends only the calls that change", () => {
    expect(
      cloudSharingWrites(own, people, {
        numbers: true,
        logging: true,
        previous: { t: true },
      }),
    ).toEqual({ numbers: ["b", "t", "i"] });
    expect(
      cloudSharingWrites({ allowPartnerLogging: false }, people, {
        numbers: false,
        logging: true,
        previous: { b: true, i: true },
      }),
    ).toEqual({ previous: ["b", "i"], logging: true });
  });
});

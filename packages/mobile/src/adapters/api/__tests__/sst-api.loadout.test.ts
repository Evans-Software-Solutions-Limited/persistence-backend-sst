/**
 * SST adapter — Loadout (spec-21) request/response wiring.
 *
 * These assert the WIRE, because the wire is where this feature's traps live: the
 * "exactly one equipment source" rule, the `equipment` param that must be omitted
 * rather than sent empty, the two long timeouts that exist so a client give-up
 * cannot waste a paid inference, and the 409 that has to stay distinguishable from
 * a generic server error.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "http://test.local" } } },
}));

// eslint-disable-next-line import/first
import { SSTApiAdapter } from "@/adapters/api/sst-api.adapter";

type FetchImpl = (input: any, init?: any) => Promise<Response>;

const globalScope = globalThis as unknown as { fetch: FetchImpl };
const originalFetch = globalScope.fetch;

afterEach(() => {
  globalScope.fetch = originalFetch;
});

function jsonOnce(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  globalScope.fetch = mock as unknown as FetchImpl;
  return mock;
}

function lastCall(mock: jest.Mock): { url: string; init: any } {
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  return { url: String(call[0]), init: call[1] };
}

const GYM = {
  id: "gym-1",
  name: "Hotel gym",
  equipmentTypeIds: ["eq-1"],
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: null,
};

describe("SSTApiAdapter — saved gyms", () => {
  it("GETs /saved-gyms and unwraps the envelope", async () => {
    const fetchMock = jsonOnce({ data: [GYM] });
    const result = await new SSTApiAdapter().getSavedGyms();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual([GYM]);
    expect(lastCall(fetchMock).url).toBe("http://test.local/saved-gyms");
  });

  it("POSTs a create with the body verbatim", async () => {
    const fetchMock = jsonOnce({ data: GYM });
    await new SSTApiAdapter().createSavedGym({
      name: "Hotel gym",
      equipmentTypeIds: ["eq-1"],
    });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://test.local/saved-gyms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Hotel gym",
      equipmentTypeIds: ["eq-1"],
    });
  });

  it("keeps a 409 duplicate name distinguishable by status AND code", async () => {
    // The picker offers "rename" on a 409 and "retry" on a 500, so collapsing the
    // two into one server error would strand the user on the wrong affordance.
    //
    // ⚠ The body is `SAVED_GYM_NAME_TAKEN` — the code the HANDLER emits. An earlier
    // version of this test invented `{ code: "duplicate_name" }`, which is a
    // `SavedGymCreateResult` status the handler translates and never serialises. It
    // passed while the union it was checking was wrong, i.e. it could not fail in
    // the way that mattered.
    jsonOnce({ code: "SAVED_GYM_NAME_TAKEN", message: "exists" }, 409);
    const result = await new SSTApiAdapter().createSavedGym({
      name: "Hotel gym",
      equipmentTypeIds: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.status).toBe(409);
    expect(!result.ok && result.error.loadoutCode).toBe("SAVED_GYM_NAME_TAKEN");
    // The handler's own message, not RN's empty statusText.
    expect(!result.ok && result.error.message).toBe("exists");
  });

  it("PATCHes an update to the id-scoped path", async () => {
    const fetchMock = jsonOnce({ data: GYM });
    await new SSTApiAdapter().updateSavedGym("gym-1", { name: "Renamed" });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://test.local/saved-gyms/gym-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Renamed" });
  });

  it("DELETEs and resolves to void rather than the raw envelope", async () => {
    const fetchMock = jsonOnce({ data: { deleted: true } });
    const result = await new SSTApiAdapter().deleteSavedGym("gym-1");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBeUndefined();
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
  });
});

describe("SSTApiAdapter.previewLoadout", () => {
  const preview = {
    workoutId: "w-1",
    parentName: "Upper Body",
    savedGymId: "gym-1",
    equipmentTypeIds: ["eq-1"],
    rows: [],
    meta: {
      keptCount: 0,
      swappedCount: 0,
      unresolvedCount: 0,
      intensityMismatchCount: 0,
      candidateCount: 0,
      candidatePoolTruncated: false,
      modelId: null,
    },
  };

  it("POSTs to the workout-scoped preview path", async () => {
    const fetchMock = jsonOnce({ data: preview });
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "gym-1",
    });

    expect(result.ok).toBe(true);
    expect(lastCall(fetchMock).url).toBe(
      "http://test.local/workouts/w-1/loadout/preview",
    );
    expect(lastCall(fetchMock).init.method).toBe("POST");
  });

  it("sends both keys through when one is explicitly null", async () => {
    // The backend accepts both keys with the unused one nulled, and that is the
    // natural client shape — dropping the null would be fine too, but silently
    // dropping BOTH (or sending both populated) is the 400.
    const fetchMock = jsonOnce({ data: preview });
    await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: null,
      equipmentTypeIds: ["eq-1"],
    });

    expect(JSON.parse(lastCall(fetchMock).init.body)).toEqual({
      savedGymId: null,
      equipmentTypeIds: ["eq-1"],
    });
  });

  it("allows the request the full API Gateway window", async () => {
    // A shorter client timeout abandons a request the server is still paying for,
    // and the usage row is written for every inference that reached the provider —
    // so a client give-up costs the user one of their daily adaptations.
    const fetchMock = jsonOnce({ data: preview });
    await new SSTApiAdapter().previewLoadout("w-1", { savedGymId: "gym-1" });

    // A timeout is wired iff an AbortSignal was attached.
    expect(lastCall(fetchMock).init.signal).toBeDefined();
  });

  it("surfaces a 429 ceiling with its status intact", async () => {
    jsonOnce({ error: "ai_daily_limit" }, 429);
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "gym-1",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.status).toBe(429);
  });

  it("surfaces a 503 outage with its status intact", async () => {
    jsonOnce({ error: "ai_unavailable" }, 503);
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "gym-1",
    });

    expect(!result.ok && result.error.status).toBe(503);
  });

  it("maps a 402 to entitlement_denied with the upgrade payload", async () => {
    jsonOnce(
      {
        code: "ENTITLEMENT_DENIED",
        error: "Premium+ required",
        feature: "loadout",
        current_tier: "premium",
        upgrade_to: "premium_plus",
        upgrade_price_monthly: 29.99,
      },
      402,
    );
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "gym-1",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("entitlement_denied");
    // The paywall reads the price from here rather than a literal.
    expect(!result.ok && result.error.entitlement?.upgradeTo).toBe(
      "premium_plus",
    );
  });
});

describe("SSTApiAdapter — Loadout domain error codes survive the wire", () => {
  // Before `requestLoadout`, every one of these collapsed to an indistinguishable
  // `{ code: "server", status: 400 }` with an EMPTY message, because
  // `mapHttpErrorToApiError` reads `body.error` and the Loadout handlers answer
  // `{ code, message }`. Each of these codes has a different remedy in the flow, so
  // losing them left the container with nothing to act on.
  const cases: readonly [string, number, () => Promise<unknown>][] = [
    [
      "EQUIPMENT_CONTEXT_REQUIRED",
      400,
      () => new SSTApiAdapter().previewLoadout("w-1", {}),
    ],
    [
      "PARENT_IS_A_VARIATION",
      400,
      () => new SSTApiAdapter().previewLoadout("w-1", { savedGymId: "g-1" }),
    ],
    [
      "UNKNOWN_SAVED_GYM",
      400,
      () => new SSTApiAdapter().previewLoadout("w-1", { savedGymId: "g-1" }),
    ],
    [
      "EMPTY_EQUIPMENT_CONTEXT",
      400,
      () => new SSTApiAdapter().previewLoadout("w-1", { equipmentTypeIds: [] }),
    ],
  ];

  for (const [code, status, call] of cases) {
    it(`preserves ${code}`, async () => {
      jsonOnce({ code, message: `${code} happened` }, status);
      const result = (await call()) as
        | { ok: true }
        | { ok: false; error: { loadoutCode?: string; message: string } };

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.loadoutCode).toBe(code);
      expect(!result.ok && result.error.message).toBe(`${code} happened`);
    });
  }

  it("preserves EQUIPMENT_NOT_AVAILABLE on the save path", async () => {
    // THE one the port docstring warns about: a deliberate pick missing
    // `isUserOverride`. Without the code the container cannot tell the user to flag
    // the row, and the whole reviewed adaptation is lost to an unexplained error.
    jsonOnce(
      {
        code: "EQUIPMENT_NOT_AVAILABLE",
        message:
          "One or more exercises need equipment this setup does not have.",
        incompatibleExerciseIds: ["ex-9"],
      },
      400,
    );
    const result = await new SSTApiAdapter().createWorkoutVariation("w-1", {
      name: "v",
      exercises: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.loadoutCode).toBe(
      "EQUIPMENT_NOT_AVAILABLE",
    );
    expect(!result.ok && result.error.message).toMatch(/need equipment/);
  });

  it("preserves EXERCISE_NOT_VISIBLE on the save path", async () => {
    jsonOnce({ code: "EXERCISE_NOT_VISIBLE", message: "hidden" }, 400);
    const result = await new SSTApiAdapter().createWorkoutVariation("w-1", {
      name: "v",
      exercises: [],
    });
    expect(!result.ok && result.error.loadoutCode).toBe("EXERCISE_NOT_VISIBLE");
  });

  it("preserves UNKNOWN_SUBSTITUTED_FROM_EXERCISE on the save path", async () => {
    jsonOnce(
      { code: "UNKNOWN_SUBSTITUTED_FROM_EXERCISE", message: "gone" },
      400,
    );
    const result = await new SSTApiAdapter().createWorkoutVariation("w-1", {
      name: "v",
      exercises: [],
    });
    expect(!result.ok && result.error.loadoutCode).toBe(
      "UNKNOWN_SUBSTITUTED_FROM_EXERCISE",
    );
  });

  it("REFUSES a code that is not a known Loadout code", async () => {
    // The membership check is what makes the union's guarantee real. Without it a
    // `switch` over `loadoutCode` would look exhaustive while silently falling
    // through on anything the backend added later.
    jsonOnce({ code: "SOMETHING_NEW", message: "?" }, 400);
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "g-1",
    });

    expect(!result.ok && result.error.loadoutCode).toBeUndefined();
    // The message still survives, so the container has something to show.
    expect(!result.ok && result.error.message).toBe("?");
  });

  it("does NOT let ENTITLEMENT_DENIED leak into loadoutCode on the 402 path", async () => {
    jsonOnce(
      {
        code: "ENTITLEMENT_DENIED",
        error: "Premium+ required",
        feature: "loadout",
        current_tier: "premium",
        upgrade_to: "premium_plus",
        upgrade_price_monthly: 29.99,
      },
      402,
    );
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "g-1",
    });

    expect(!result.ok && result.error.code).toBe("entitlement_denied");
    expect(!result.ok && result.error.loadoutCode).toBeUndefined();
  });

  it("leaves loadoutCode UNSET when the body carries no code", async () => {
    // The AI endpoints answer `{ error: "ai_daily_limit" }`, not `{ code }` — the
    // status is the signal there, and inventing a code would be worse than none.
    jsonOnce({ error: "ai_daily_limit" }, 429);
    const result = await new SSTApiAdapter().scanEquipment({
      imageBase64: "abc",
      mediaType: "image/jpeg",
    });

    expect(!result.ok && result.error.loadoutCode).toBeUndefined();
    expect(!result.ok && result.error.status).toBe(429);
    // The `{ error }` shape still yields a usable message.
    expect(!result.ok && result.error.message).toBe("ai_daily_limit");
  });

  it("still maps 402 to entitlement_denied through the raw path", async () => {
    // `requestLoadout` delegates to `mapHttpErrorToApiError`, so the structured
    // paywall payload must survive the switch away from `requestEnvelope`.
    jsonOnce(
      {
        code: "ENTITLEMENT_DENIED",
        error: "Premium+ required",
        feature: "loadout",
        current_tier: "premium",
        upgrade_to: "premium_plus",
        upgrade_price_monthly: 29.99,
      },
      402,
    );
    const result = await new SSTApiAdapter().previewLoadout("w-1", {
      savedGymId: "g-1",
    });

    expect(!result.ok && result.error.code).toBe("entitlement_denied");
    expect(!result.ok && result.error.entitlement?.upgradeTo).toBe(
      "premium_plus",
    );
  });
});

describe("SSTApiAdapter — variations", () => {
  it("POSTs the reviewed plan, substitutionReason and isUserOverride included", async () => {
    const fetchMock = jsonOnce({ data: { id: "v-1" } });
    await new SSTApiAdapter().createWorkoutVariation("w-1", {
      name: "Upper Body · Hotel gym",
      sourceGymId: "gym-1",
      sourceEquipmentTypeIds: ["eq-1"],
      exercises: [
        {
          exerciseId: "ex-2",
          sortOrder: 0,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          substitutedFromExerciseId: "ex-1",
          substitutionReason: {
            code: "equipment_unavailable",
            missingEquipment: ["eq-9"],
            matchedOn: ["primary_muscles"],
            flags: [],
            note: "Dumbbells work here",
            selectedBy: "model",
          },
          isUserOverride: true,
        },
      ],
    });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://test.local/workouts/w-1/variations");
    const body = JSON.parse(init.body);
    // The save path re-verifies containment on rows NOT flagged as overrides, so
    // dropping either field here turns a deliberate pick into a 400.
    expect(body.exercises[0].isUserOverride).toBe(true);
    expect(body.exercises[0].substitutionReason.code).toBe(
      "equipment_unavailable",
    );
    expect(body.exercises[0].substitutedFromExerciseId).toBe("ex-1");
  });

  it("GETs the parent's variations", async () => {
    const fetchMock = jsonOnce({ data: [] });
    await new SSTApiAdapter().getWorkoutVariations("w-1");
    expect(lastCall(fetchMock).url).toBe(
      "http://test.local/workouts/w-1/variations",
    );
  });
});

describe("SSTApiAdapter.getExerciseSubstitutes", () => {
  const payload = { best: [], others: [], meta: { truncated: false } };

  it("sends equipment as repeated keys", async () => {
    const fetchMock = jsonOnce({ data: payload });
    await new SSTApiAdapter().getExerciseSubstitutes({
      forExerciseId: "ex-1",
      equipment: ["eq-1", "eq-2"],
    });

    const url = new URL(lastCall(fetchMock).url);
    expect(url.pathname).toBe("/exercises/substitutes");
    expect(url.searchParams.get("forExerciseId")).toBe("ex-1");
    expect(url.searchParams.getAll("equipment")).toEqual(["eq-1", "eq-2"]);
  });

  it("OMITS equipment entirely when there is no kit", async () => {
    // Not `equipment=`: an absent param is the documented "no kit known" case
    // (empty `best`, everything in `others`) that lets one endpoint serve the
    // standalone in-session swap as well as the Loadout review row.
    const fetchMock = jsonOnce({ data: payload });
    await new SSTApiAdapter().getExerciseSubstitutes({ forExerciseId: "ex-1" });

    const url = new URL(lastCall(fetchMock).url);
    expect(url.searchParams.has("equipment")).toBe(false);
  });

  it("OMITS equipment when an empty array is passed", async () => {
    const fetchMock = jsonOnce({ data: payload });
    await new SSTApiAdapter().getExerciseSubstitutes({
      forExerciseId: "ex-1",
      equipment: [],
    });

    expect(new URL(lastCall(fetchMock).url).searchParams.has("equipment")).toBe(
      false,
    );
  });

  it("passes limit through only when supplied", async () => {
    const fetchMock = jsonOnce({ data: payload });
    await new SSTApiAdapter().getExerciseSubstitutes({
      forExerciseId: "ex-1",
      limit: 10,
    });
    expect(new URL(lastCall(fetchMock).url).searchParams.get("limit")).toBe(
      "10",
    );

    const withoutLimit = jsonOnce({ data: payload });
    await new SSTApiAdapter().getExerciseSubstitutes({ forExerciseId: "ex-1" });
    expect(new URL(lastCall(withoutLimit).url).searchParams.has("limit")).toBe(
      false,
    );
  });
});

describe("SSTApiAdapter.scanEquipment", () => {
  const draft = {
    detected: [],
    unmatched: [],
    notes: null,
    modelId: "eu.anthropic.claude-opus-4-6-v1",
  };

  it("POSTs the base64 image to /ai/equipment-scan", async () => {
    const fetchMock = jsonOnce({ data: draft });
    const result = await new SSTApiAdapter().scanEquipment({
      imageBase64: "abc",
      mediaType: "image/jpeg",
    });

    expect(result.ok).toBe(true);
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://test.local/ai/equipment-scan");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      imageBase64: "abc",
      mediaType: "image/jpeg",
    });
  });

  it("allows the scan the full window — it is the slowest call in the app", async () => {
    const fetchMock = jsonOnce({ data: draft });
    await new SSTApiAdapter().scanEquipment({
      imageBase64: "abc",
      mediaType: "image/png",
    });
    expect(lastCall(fetchMock).init.signal).toBeDefined();
  });

  it("keeps 429 / 422 / 503 distinguishable by status", async () => {
    for (const status of [429, 422, 503]) {
      jsonOnce({ error: "x" }, status);
      const result = await new SSTApiAdapter().scanEquipment({
        imageBase64: "abc",
        mediaType: "image/jpeg",
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.status).toBe(status);
    }
  });
});

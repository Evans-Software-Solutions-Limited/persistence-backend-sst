import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  TOGETHER_DEFAULTS,
  normaliseTogetherDefaults,
  useTogetherSettings,
} from "../together-settings";
// The global setup mock is a no-op; this suite needs a real key/value store.
jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => store.clear()),
      getAllKeys: jest.fn(async () => [...store.keys()]),
    },
  };
});

/** Together defaults preset the start sheet (PER-60, canvas 1b). Persisted per account. */
describe("useTogetherSettings", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useTogetherSettings.getState().reset();
  });

  it("ships Nearby and Training partners as the defaults", () => {
    expect(TOGETHER_DEFAULTS).toEqual({
      connection: "local",
      audience: "friends",
    });
    expect(useTogetherSettings.getState()).toMatchObject({
      ...TOGETHER_DEFAULTS,
      userId: null,
    });
  });

  it("rehydrates a saved record for the account and keeps defaults for a missing or corrupt one", async () => {
    await AsyncStorage.setItem(
      "persistence.together.defaults.v1:u",
      JSON.stringify({ connection: "online", audience: "invite-only" }),
    );
    await useTogetherSettings.getState().rehydrate("u");
    expect(useTogetherSettings.getState()).toMatchObject({
      userId: "u",
      connection: "online",
      audience: "invite-only",
    });
    await useTogetherSettings.getState().rehydrate("nobody");
    expect(useTogetherSettings.getState()).toMatchObject({
      userId: "nobody",
      ...TOGETHER_DEFAULTS,
    });
    await AsyncStorage.setItem("persistence.together.defaults.v1:c", "{nope");
    await useTogetherSettings.getState().rehydrate("c");
    expect(useTogetherSettings.getState()).toMatchObject(TOGETHER_DEFAULTS);
    await AsyncStorage.setItem(
      "persistence.together.defaults.v1:d",
      JSON.stringify({ connection: "carrier-pigeon", audience: "open" }),
    );
    await useTogetherSettings.getState().rehydrate("d");
    expect(useTogetherSettings.getState()).toMatchObject(TOGETHER_DEFAULTS);
  });

  it("ignores a rehydrate that resolves after the account changed", async () => {
    await AsyncStorage.setItem(
      "persistence.together.defaults.v1:a",
      JSON.stringify({ connection: "online", audience: "friends" }),
    );
    const first = useTogetherSettings.getState().rehydrate("a");
    await useTogetherSettings.getState().rehydrate("b");
    await first;
    expect(useTogetherSettings.getState()).toMatchObject({
      userId: "b",
      connection: "local",
    });
  });

  it("saves changed defaults for the account and demotes Open nearby under Online", async () => {
    await useTogetherSettings.getState().rehydrate("u");
    await useTogetherSettings.getState().setDefaults({ audience: "open" });
    expect(
      JSON.parse(
        (await AsyncStorage.getItem("persistence.together.defaults.v1:u"))!,
      ),
    ).toEqual({ connection: "local", audience: "open" });
    await useTogetherSettings.getState().setDefaults({ connection: "online" });
    expect(useTogetherSettings.getState()).toMatchObject({
      connection: "online",
      audience: "friends",
    });
    expect(
      normaliseTogetherDefaults({ connection: "online", audience: "open" }),
    ).toEqual({
      connection: "online",
      audience: "friends",
    });
    expect(
      normaliseTogetherDefaults({ connection: "local", audience: "open" }),
    ).toEqual({
      connection: "local",
      audience: "open",
    });
  });

  it("does not persist without an account and survives a storage failure", async () => {
    await useTogetherSettings.getState().setDefaults({ connection: "online" });
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(useTogetherSettings.getState().connection).toBe("online");
    await useTogetherSettings.getState().rehydrate("u");
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValueOnce(new Error("disk"));
    await useTogetherSettings
      .getState()
      .setDefaults({ audience: "invite-only" });
    expect(useTogetherSettings.getState().audience).toBe("invite-only");
  });

  it("reset returns to the shipped defaults (used by signOut)", async () => {
    await useTogetherSettings.getState().rehydrate("u");
    await useTogetherSettings.getState().setDefaults({ connection: "online" });
    useTogetherSettings.getState().reset();
    expect(useTogetherSettings.getState()).toMatchObject({
      ...TOGETHER_DEFAULTS,
      userId: null,
    });
  });
});

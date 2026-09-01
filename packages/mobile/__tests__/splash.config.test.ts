import appJson from "../app.json";

describe("native splash configuration", () => {
  it("uses the canonical dark surface in both device appearances", () => {
    const splashPlugin = appJson.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    );

    expect(splashPlugin).toEqual([
      "expo-splash-screen",
      expect.objectContaining({
        image: "./assets/icons/splash-icon-dark.png",
        backgroundColor: "#0A0B12",
        dark: expect.objectContaining({
          image: "./assets/icons/splash-icon-dark.png",
          backgroundColor: "#0A0B12",
        }),
      }),
    ]);
  });
});

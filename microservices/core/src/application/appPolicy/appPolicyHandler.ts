import Elysia, { t } from "elysia";

const version = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
// Public bootstrap metadata: available before sign-in and independent of Together.
export const appPolicyHandler = new Elysia({ name: "appPolicyHandler" }).get(
  "/app-policy",
  ({ set }) => {
    const iosMinimumVersion = process.env.APP_MIN_IOS_VERSION || "1.1.3";
    const androidMinimumVersion =
      process.env.APP_MIN_ANDROID_VERSION || "1.1.3";
    set.headers["cache-control"] = "no-store";
    if (
      !version.test(iosMinimumVersion) ||
      !version.test(androidMinimumVersion)
    ) {
      set.status = 503;
      return { error: "App version policy is unavailable" };
    }
    return { iosMinimumVersion, androidMinimumVersion };
  },
  {
    response: {
      200: t.Object({
        iosMinimumVersion: t.String(),
        androidMinimumVersion: t.String(),
      }),
      503: t.Object({ error: t.String() }),
    },
  },
);

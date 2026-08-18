import appJson from "../../../../app.json";
import { HEALTH_CONNECT_PERMISSIONS } from "@/adapters/health/health-connect.adapter";

/**
 * Play review rejected version code 4 because `app.json` declared a Health
 * Connect data type (`BasalMetabolicRate`) that no screen rendered. The
 * manifest is the artefact Google scans, and it is coupled to
 * {@link HEALTH_CONNECT_PERMISSIONS} by convention alone — a scope added to
 * one and not the other ships a mismatch that either crashes the request or
 * re-trips the "Minimum Scope" policy.
 *
 * This asserts the two are the same set, in both directions. The record-type
 * mapping is explicit rather than derived because Health Connect's permission
 * names are not a mechanical transform of its record types — `SleepSession`
 * maps to `READ_SLEEP`, not `READ_SLEEP_SESSION`.
 */
const PERMISSION_SUFFIX: Record<string, string> = {
  Steps: "STEPS",
  ActiveCaloriesBurned: "ACTIVE_CALORIES_BURNED",
  Weight: "WEIGHT",
  BodyFat: "BODY_FAT",
  HeartRate: "HEART_RATE",
  SleepSession: "SLEEP",
};

const HEALTH_PREFIX = "android.permission.health.";

describe("Health Connect manifest parity", () => {
  const declared = (appJson.expo.android.permissions ?? []).filter((name) =>
    name.startsWith(HEALTH_PREFIX),
  );

  it("declares exactly the scopes the adapter requests", () => {
    const fromAdapter = HEALTH_CONNECT_PERMISSIONS.map((permission) => {
      const suffix = PERMISSION_SUFFIX[permission.recordType];
      if (!suffix) {
        throw new Error(
          `No manifest mapping for record type "${permission.recordType}" — ` +
            "add it to PERMISSION_SUFFIX and to app.json's android.permissions.",
        );
      }
      return `${HEALTH_PREFIX}${permission.accessType.toUpperCase()}_${suffix}`;
    });

    expect([...declared].sort()).toEqual([...fromAdapter].sort());
  });

  it("does not declare BasalMetabolicRate", () => {
    // Regression guard for the Play rejection of version code 4. Reinstating
    // this requires a screen that renders resting energy AND an updated Play
    // Console Health Connect declaration — see
    // specs/milestones/ANDROID-LAUNCH/HEALTH-CONNECT-DECLARATION.md.
    expect(declared).not.toContain(
      "android.permission.health.READ_BASAL_METABOLIC_RATE",
    );
    expect(
      HEALTH_CONNECT_PERMISSIONS.map((permission) => permission.recordType),
    ).not.toContain("BasalMetabolicRate");
  });
});

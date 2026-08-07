const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");

const ACTIVITY_NAME = ".HealthConnectPermissionsRationaleActivity";
const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const VIEW_PERMISSION_USAGE_ALIAS = "ViewPermissionUsageActivity";
const VIEW_PERMISSION_USAGE_ACTION =
  "android.intent.action.VIEW_PERMISSION_USAGE";
const HEALTH_PERMISSIONS_CATEGORY =
  "android.intent.category.HEALTH_PERMISSIONS";
const PRIVACY_POLICY_URL =
  "https://persistence.evans-software-solutions.com/privacy";

function hasAction(intentFilter, actionName) {
  return (intentFilter.action ?? []).some(
    (action) => action.$?.["android:name"] === actionName,
  );
}

function withRationaleManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      manifestConfig.modResults,
    );

    // Keep both Android 13 and Android 14+ rationale entry points on a
    // dedicated privacy-policy surface. The native library autolinks without
    // its stock Expo plugin; this plugin owns the complete manifest contract.
    mainActivity["intent-filter"] = (
      mainActivity["intent-filter"] ?? []
    ).filter((filter) => !hasAction(filter, RATIONALE_ACTION));

    const activities = (mainApplication.activity ??= []);
    let rationale = activities.find(
      (activity) => activity.$?.["android:name"] === ACTIVITY_NAME,
    );
    if (!rationale) {
      rationale = {
        $: {
          "android:name": ACTIVITY_NAME,
          "android:exported": "true",
        },
        "intent-filter": [],
      };
      activities.push(rationale);
    }
    rationale["intent-filter"] = [
      {
        action: [{ $: { "android:name": RATIONALE_ACTION } }],
      },
    ];

    const aliases = (mainApplication["activity-alias"] ??= []);
    let permissionUsageAlias = aliases.find(
      (alias) => alias.$?.["android:name"] === VIEW_PERMISSION_USAGE_ALIAS,
    );
    if (!permissionUsageAlias) {
      permissionUsageAlias = {
        $: {
          "android:name": VIEW_PERMISSION_USAGE_ALIAS,
          "android:exported": "true",
          "android:targetActivity": ACTIVITY_NAME,
          "android:permission":
            "android.permission.START_VIEW_PERMISSION_USAGE",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": VIEW_PERMISSION_USAGE_ACTION } }],
            category: [{ $: { "android:name": HEALTH_PERMISSIONS_CATEGORY } }],
          },
        ],
      };
      aliases.push(permissionUsageAlias);
    } else {
      permissionUsageAlias.$["android:targetActivity"] = ACTIVITY_NAME;
    }

    return manifestConfig;
  });
}

function withRationaleActivity(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const packageName = modConfig.android?.package;
      if (!packageName) {
        throw new Error(
          "android.package is required for the Health Connect rationale activity",
        );
      }
      const sourceDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
      );
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, "HealthConnectPermissionsRationaleActivity.kt"),
        `package ${packageName}

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

class HealthConnectPermissionsRationaleActivity : Activity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = "Persistence Privacy Policy"
    webView = WebView(this).also { view ->
      view.webViewClient = WebViewClient()
      view.settings.javaScriptEnabled = false
      view.loadUrl("${PRIVACY_POLICY_URL}")
      setContentView(view)
    }
  }

  override fun onDestroy() {
    webView?.destroy()
    webView = null
    super.onDestroy()
  }
}
`,
      );
      return modConfig;
    },
  ]);
}

module.exports = function withHealthConnectRationale(config) {
  return withRationaleActivity(withRationaleManifest(config));
};

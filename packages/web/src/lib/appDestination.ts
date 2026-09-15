import { currentPlatform } from "./platform";
import {
  appStoreLive,
  appStoreUrl,
  playStoreLive,
  playStoreUrl,
} from "@/marketing/config";

/** Reuse the site's store configuration and device detection, without tracking. */
export function appDestination() {
  const platform = currentPlatform();
  if (platform === "ios" && appStoreLive())
    return { href: appStoreUrl()!, label: "Open in App Store" };
  if (platform === "android" && playStoreLive())
    return { href: playStoreUrl()!, label: "Open in Google Play" };
  return { href: "/", label: "Go to Persistence" };
}

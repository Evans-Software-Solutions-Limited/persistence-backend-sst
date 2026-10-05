import { requireOptionalNativeModule } from "expo";
import type { TogetherLanNative, TogetherLanEvent } from "../together-lan";
import { frameNearby } from "./framing";

/** Native Nearby remains raw, unauthenticated routing, just like the LAN module. */
export const nearbyNative = requireOptionalNativeModule<
  TogetherLanNative & { available: boolean }
>("TogetherNearby");
export const togetherNearby = nearbyNative?.available
  ? frameNearby(nearbyNative)
  : null;
export type { TogetherLanEvent };

import Constants from "expo-constants";
import {
  createTogetherInvitationLink,
  type TogetherInvitation,
} from "@/application/together/invitation";

/** Use the installed distribution's scheme so staging opens staging. */
export function togetherInvitationLink(value: TogetherInvitation): string {
  const configured = Constants.expoConfig?.scheme;
  const scheme = Array.isArray(configured) ? configured[0] : configured;
  return createTogetherInvitationLink(scheme ?? "persistencemobile", value);
}

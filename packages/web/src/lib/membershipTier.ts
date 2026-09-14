import { SUBSCRIPTION_CATALOG } from "@persistence/subscription-catalog";
/** Display the actual plan, including future plans, without silently calling it Premium. */
export function membershipTierLabel(id: string): string {
  return SUBSCRIPTION_CATALOG.find((tier) => tier.id === id)?.name ?? id;
}
export function isCoachMembership(id: string): boolean {
  return SUBSCRIPTION_CATALOG.some(
    (tier) => tier.id === id && tier.audience === "coach",
  );
}

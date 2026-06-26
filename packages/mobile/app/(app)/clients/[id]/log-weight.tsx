import { LogClientWeightContainer } from "@/ui/containers/LogClientWeightContainer";

/**
 * /clients/[id]/log-weight — coach logs a body weight for a client
 * (10-trainer-features, weight-sync flow). The value is written for the client
 * and synced into their HealthKit on their next app open.
 */
export default function LogClientWeightScreen() {
  return <LogClientWeightContainer />;
}

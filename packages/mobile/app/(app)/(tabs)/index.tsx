import { HomeContainer } from "../../../src/ui/containers/HomeContainer";

/**
 * Home tab — the first screen users land on after sign-in. Thin
 * wrapper around `HomeContainer`; all logic lives there.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) · requirements.md STORY-005
 */
export default function Home() {
  return <HomeContainer />;
}

/**
 * Hero device — crossfades the real app Home → Active workout → Fuel screens
 * (mirrors packages/mobile). When `screenshot` is set it renders that instead.
 */
import { PhoneDevice } from "./PhoneDevice";
import { HomeScreen } from "./screens/HomeScreen";
import { ActiveWorkoutScreen } from "./screens/ActiveWorkoutScreen";
import { FuelScreen } from "./screens/FuelScreen";

export function PhoneMock({ screenshot }: { screenshot?: string | null }) {
  return (
    <PhoneDevice
      screenshot={screenshot}
      screens={[<HomeScreen key="home" />, <ActiveWorkoutScreen key="aw" />, <FuelScreen key="fuel" />]}
    />
  );
}

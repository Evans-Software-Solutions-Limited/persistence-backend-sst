import { Slot } from "expo-router";
import { AppProviders } from "../src/providers";

export default function RootLayout() {
  return (
    <AppProviders>
      <Slot />
    </AppProviders>
  );
}

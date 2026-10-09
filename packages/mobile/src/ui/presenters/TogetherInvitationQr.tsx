import { useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";

/** Large, high-contrast invitation with a quiet zone; fits narrow phone sheets. */
export function TogetherInvitationQr({ value }: { value: string }) {
  const { width } = useWindowDimensions();
  return (
    <QRCode
      value={value}
      size={Math.min(304, Math.max(1, width - 80))}
      quietZone={28}
      color="black"
      backgroundColor="white"
      ecl="M"
    />
  );
}

import { useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";

/** Large, high-contrast invitation with a quiet zone; fits narrow phone sheets. */
export function TogetherInvitationQr({
  value,
  size,
  quietZone = 28,
}: {
  value: string;
  /** Fixed edge in points; defaults to the width-based size. */
  size?: number;
  quietZone?: number;
}) {
  const { width } = useWindowDimensions();
  return (
    <QRCode
      value={value}
      size={size ?? Math.min(304, Math.max(1, width - 80))}
      quietZone={quietZone}
      color="black"
      backgroundColor="white"
      ecl="M"
    />
  );
}

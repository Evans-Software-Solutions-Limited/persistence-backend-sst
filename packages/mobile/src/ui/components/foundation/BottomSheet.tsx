import GorhomBottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Text, View } from "@tamagui/core";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toneHex, toneTokens } from "./tones";

/**
 * <BottomSheet> — slide-up modal for inline flows (Scan, Snap, Quick add,
 * ProfileDrawer). Ports fuel-sheets.jsx:13-42 + extra.jsx:7-25.
 * Implements 01-design-system/design.md § Foundation primitives #12 +
 * STORY-003 AC 3.6 + the 2026-05-29 revision (gorhom v5, not v4).
 *
 * Default 78% height; `peek` drops to 60%. Backdrop tap dismisses. The header
 * (eyebrow + title + drag handle) is fixed; children scroll. `accent` tints
 * the eyebrow + drag-handle.
 */

export type BottomSheetAccent = "primary" | "gold" | "trainer" | "ember";
export type BottomSheetHeight = number | "peek" | "default";

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  accent?: BottomSheetAccent;
  /** peek=60%, default=78%, or an explicit percentage number (0-100). */
  height?: BottomSheetHeight;
  children: ReactNode;
  testID?: string;
};

function resolveSnap(height: BottomSheetHeight): string {
  if (height === "peek") return "60%";
  if (height === "default") return "78%";
  return `${Math.min(100, Math.max(10, height))}%`;
}

/** Accent as a Tamagui token — for the eyebrow <Text> (resolves the theme). */
function accentToken(accent?: BottomSheetAccent): string {
  if (!accent) return "$text3";
  return toneTokens(accent).base;
}

/** Accent as a concrete colour — for the gorhom drag-handle (plain RN, no
 * Tamagui token resolution). */
function accentHex(accent?: BottomSheetAccent): string {
  if (!accent) return "rgba(255,255,255,0.16)";
  return toneHex(accent).base;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  eyebrow,
  accent,
  height = "default",
  children,
  testID,
}: BottomSheetProps) {
  const ref = useRef<GorhomBottomSheet>(null);
  const snapPoints = useMemo(() => [resolveSnap(height)], [height]);

  // Render the sheet once it has been opened at least once, then keep it
  // mounted so a parent-driven close (`setVisible(false)`) animates DOWN via
  // `ref.current.close()` instead of unmounting synchronously (which would
  // null the ref before the close call and snap the sheet shut). gorhom holds
  // the closed sheet at `index = -1`; `onAnimate` clears `mounted` only after
  // the close settles, dropping the machinery from the tree (PR #83 review).
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      ref.current?.expand();
    } else {
      ref.current?.close();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.6}
      />
    ),
    [],
  );

  // Once the close animation settles on the closed index (-1), drop the sheet
  // from the tree to keep it light. gorhom fires onAnimate(from, to) at the
  // start of the transition; we wait for the change handler below.
  const handleChange = useCallback(
    (index: number) => {
      if (index === -1 && !visible) {
        setMounted(false);
      }
    },
    [visible],
  );

  // Never been opened → render nothing (no flash, light tree).
  if (!mounted) {
    return null;
  }

  return (
    <GorhomBottomSheet
      ref={ref}
      index={visible ? 0 : -1}
      onChange={handleChange}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{
        backgroundColor: accentHex(accent),
        width: 40,
        height: 4,
      }}
      backgroundStyle={{ backgroundColor: "#12141D" }}
      style={{
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: "hidden",
      }}
    >
      <BottomSheetView testID={testID} style={{ flex: 1 }}>
        {title || eyebrow ? (
          <View
            paddingHorizontal={20}
            paddingTop={4}
            paddingBottom={12}
            borderBottomWidth={1}
            borderColor="$border"
          >
            {eyebrow ? (
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.7}
                textTransform="uppercase"
                color={accentToken(accent)}
                marginBottom={4}
              >
                {eyebrow}
              </Text>
            ) : null}
            {title ? (
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={20}
                letterSpacing={-0.4}
                color="$text"
              >
                {title}
              </Text>
            ) : null}
          </View>
        ) : null}

        <BottomSheetScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        >
          {children}
        </BottomSheetScrollView>
      </BottomSheetView>
    </GorhomBottomSheet>
  );
}

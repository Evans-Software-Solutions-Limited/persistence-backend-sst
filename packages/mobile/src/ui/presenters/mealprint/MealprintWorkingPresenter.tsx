import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { Skeleton } from "@/ui/components/Skeleton";
import { IconSparkles } from "@/ui/components/icons";
import { BackBtn } from "@/ui/presenters/fuel/plans/PlanChrome";
import { BigIcon, MealprintPage } from "./MealprintChrome";

/**
 * <MealprintWorkingPresenter> — canvas N16 "Working out what fits…"
 * (PER-134): a few seconds, a skeleton rather than a spinner. Used for one
 * meal and for a whole day. Pure.
 */

export type MealprintWorkingProps = {
  /** "Fitting a meal to…" or "Filling your day…". */
  body: string;
  onBack: () => void;
  onCancel: () => void;
  testID?: string;
};

const LINES = ["80%", "65%", "72%"] as const;

export function MealprintWorkingPresenter({
  body,
  onBack,
  onCancel,
  testID = "mealprint-working",
}: MealprintWorkingProps) {
  return (
    <MealprintPage
      testID={testID}
      scroll={false}
      left={<BackBtn onPress={onBack} testID={`${testID}-back`} />}
      eyebrow="Mealprint"
      footer={
        <Btn
          variant="outline"
          tone="primary"
          size="lg"
          full
          onPress={onCancel}
          testID={`${testID}-cancel`}
        >
          Cancel
        </Btn>
      }
    >
      <View alignItems="center" accessibilityState={{ busy: true }}>
        <BigIcon marginTop={70}>
          <IconSparkles size={36} color="#22D3EE" />
        </BigIcon>
        <Text
          marginTop={28}
          fontFamily="$display"
          fontSize={26}
          lineHeight={32}
          fontWeight="800"
          letterSpacing={-0.5}
          color="$text"
          textAlign="center"
          accessibilityRole="header"
        >
          Working out what fits…
        </Text>
        <Text
          marginTop={8}
          maxWidth={300}
          fontFamily="$body"
          fontSize={14}
          lineHeight={20}
          color="$text2"
          textAlign="center"
        >
          {body}
        </Text>
      </View>
      <View
        marginTop={44}
        gap={22}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {LINES.map((width) => (
          <View key={width} flexDirection="row" alignItems="center" gap={14}>
            <Skeleton width={56} height={56} />
            <View flex={1} gap={8}>
              <Skeleton width={width} height={14} />
              <Skeleton width="60%" height={10} />
            </View>
            <Skeleton width={44} height={18} />
          </View>
        ))}
      </View>
    </MealprintPage>
  );
}

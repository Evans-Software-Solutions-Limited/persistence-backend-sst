import { View } from "@tamagui/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ComingSoon } from "../../../../src/ui/components/ComingSoon";
import { Btn } from "../../../../src/ui/components/foundation";

/**
 * `/clients/[id]` — per-client detail stub.
 *
 * The full 5-tab Client Detail screen is a later slice; until then this keeps
 * the intentional "Coming Soon" placeholder but surfaces the one action that's
 * wired today: logging a weight for the client (10-trainer-features weight-sync
 * flow), which syncs into the client's HealthKit on their next app open.
 */
export default function ClientDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View flex={1}>
      <ComingSoon
        icon="person-outline"
        title="Client"
        description="The full client detail screen arrives in the next slice."
        safeAreaTop
        testID="client-detail-coming-soon"
      />
      <View
        position="absolute"
        left={20}
        right={20}
        bottom={insets.bottom + 20}
      >
        <Btn
          full
          variant="filled"
          tone="trainer"
          onPress={() =>
            router.push({
              pathname: "/(app)/clients/[id]/log-weight",
              params: { id, ...(name ? { name } : {}) },
            } as never)
          }
          testID="client-detail-log-weight"
        >
          Log weight
        </Btn>
      </View>
    </View>
  );
}

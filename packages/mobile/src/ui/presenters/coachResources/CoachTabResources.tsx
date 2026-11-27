import { Text, View } from "@tamagui/core";

import type { AthleteResource } from "@/domain/models/coachResources";
import { resourceMeta } from "@/domain/services/coachResources.service";
import { Eyebrow } from "@/ui/presenters/coaching/coachingKit";
import { ResourceRow } from "./resourceKit";

/**
 * C2e "Resources" on the athlete's Coach tab (PER-143): what this coach
 * shared, newest first, with a count. Tapping one opens it; the coach sees
 * it as opened.
 */
export function CoachTabResources(p: {
  firstName: string;
  rows: AthleteResource[] | null;
  onOpen: (assignmentId: string) => void;
}) {
  return (
    <View marginTop={22} testID="coach-tab-resources">
      <View flexDirection="row" alignItems="center" gap={8} marginBottom={6}>
        <Eyebrow>Resources</Eyebrow>
        {p.rows && p.rows.length > 0 ? (
          <Text
            fontFamily="$mono"
            fontWeight="600"
            fontSize={12}
            color="$text3"
            testID="coach-tab-resources-count"
          >
            {p.rows.length}
          </Text>
        ) : null}
      </View>
      {p.rows === null ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          testID="coach-tab-resources-loading"
        >
          Loading resources…
        </Text>
      ) : p.rows.length === 0 ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          testID="coach-tab-resources-empty"
        >
          {`Nothing from ${p.firstName} yet. Files and links ${p.firstName} shares show here.`}
        </Text>
      ) : (
        p.rows.map((r) => (
          <ResourceRow
            key={r.assignmentId}
            kind={r.kind}
            mime={r.mime}
            title={r.title}
            subtitle={resourceMeta(r)}
            chevron
            onPress={() => p.onOpen(r.assignmentId)}
            accessibilityLabel={`Open ${r.title}`}
            testID={`coach-tab-resource-${r.assignmentId}`}
          />
        ))
      )}
    </View>
  );
}

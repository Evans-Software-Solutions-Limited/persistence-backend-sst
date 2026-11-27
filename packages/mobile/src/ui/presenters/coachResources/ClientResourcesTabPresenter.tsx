import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation";
import { IconPlus } from "@/ui/components/icons";
import type { ClientResource } from "@/domain/models/coachResources";
import { sharedLine } from "@/domain/services/coachResources.service";
import { Note } from "@/ui/presenters/coachForms/kit";
import { OpenedPill, ResourceRow } from "./resourceKit";

/**
 * C3.7b — the client's Resources tab on iPhone: what they have and whether
 * they opened it, then "Add resources" (the C3.7c sheet). Tapping a row
 * offers Remove. While the coach has Resources switched off for this client
 * (C3.9, PER-150) the list stays and can be pruned, but sharing is refused.
 */
export type ClientResourcesTabPresenterProps = {
  firstName: string;
  rows: ClientResource[] | null;
  offline: boolean;
  /** A queued share the server refused with 403 `resources_off`. */
  refused: boolean;
  notice: string | null;
  onAdd: () => void;
  onRow: (row: ClientResource) => void;
  onDismissRefused: () => void;
  onDismissNotice: () => void;
};

export function ClientResourcesTabPresenter(
  p: ClientResourcesTabPresenterProps,
) {
  return (
    <View paddingHorizontal={20} testID="client-resources">
      {p.offline ? (
        <Note testID="client-resources-offline">
          You're offline. Shares and links are saved on this phone and send when
          you're back. Uploads need a connection.
        </Note>
      ) : null}
      {p.refused ? (
        <Note onDismiss={p.onDismissRefused} testID="client-resources-refused">
          {`Resources are switched off for ${p.firstName}, so that wasn't shared. Switch Resources on in ${p.firstName}'s settings to share.`}
        </Note>
      ) : null}
      {p.notice ? (
        <Note onDismiss={p.onDismissNotice} testID="client-resources-notice">
          {p.notice}
        </Note>
      ) : null}
      <View marginTop={12}>
        {p.rows === null ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            testID="client-resources-loading"
          >
            Loading resources…
          </Text>
        ) : p.rows.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            lineHeight={18}
            color="$text3"
            testID="client-resources-empty"
          >
            {`Nothing shared with ${p.firstName} yet. Add something from your Library, or upload a photo or add a link.`}
          </Text>
        ) : (
          p.rows.map((row) => (
            <ResourceRow
              key={row.assignmentId}
              kind={row.resource.kind}
              mime={row.resource.mime}
              title={row.resource.title}
              subtitle={sharedLine(row)}
              right={<OpenedPill opened={!!row.openedAt} />}
              chevron
              onPress={() => p.onRow(row)}
              accessibilityLabel={`${row.resource.title}, ${row.openedAt ? "opened" : "not opened"}`}
              testID={`client-resource-${row.assignmentId}`}
            />
          ))
        )}
      </View>
      <View marginTop={16} alignItems="flex-end">
        <Btn
          variant="filled"
          tone="trainer"
          icon={<IconPlus size={16} />}
          onPress={p.onAdd}
          testID="client-resources-add"
        >
          Add resources
        </Btn>
      </View>
    </View>
  );
}

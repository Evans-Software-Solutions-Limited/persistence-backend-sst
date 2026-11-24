import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  compareRows,
  previousResponse,
  shortDate,
} from "@/domain/services/coachForms.service";
import {
  useCoachFormResponses,
  useCoachFormsActions,
} from "@/ui/hooks/useCoachForms";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { FormResponsePresenter } from "@/ui/presenters/coachForms/FormResponsePresenter";

/**
 * Review one check-in: compare it with any earlier response to the same form
 * (the one before it by default), Mark reviewed, reply. Both writes queue
 * (idempotent on the server), so they work offline.
 */
export function FormResponseContainer() {
  const router = useRouter();
  const { id: clientId, responseId } = useLocalSearchParams<{
    id: string;
    responseId: string;
  }>();
  const responses = useCoachFormResponses(clientId ?? "");
  const actions = useCoachFormsActions({
    onLocalWrite: () => responses.reload(),
  });
  const online = useOnlineStatus();
  const list = useMemo(() => responses.data ?? [], [responses.data]);
  const response = list.find((r) => r.id === responseId) ?? null;
  const earlier = useMemo(
    () =>
      response
        ? list.filter(
            (r) =>
              r.formId === response.formId &&
              r.id !== response.id &&
              r.submittedAt < response.submittedAt,
          )
        : [],
    [list, response],
  );
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const compare =
    picked === undefined
      ? response
        ? previousResponse(list, response)
        : null
      : (earlier.find((r) => r.id === picked) ?? null);
  const [reply, setReply] = useState("");

  const review = async (text?: string) => {
    if (!clientId || !response) return;
    await actions.review(clientId, response.id, text);
    if (text !== undefined) setReply("");
    responses.reload();
  };

  return (
    <FormResponsePresenter
      found={response !== null}
      title={response?.title ?? ""}
      dateLabel={response ? shortDate(response.submittedAt) : ""}
      late={response?.late === true}
      reviewedLabel={
        response?.reviewedAt
          ? `Reviewed ${shortDate(response.reviewedAt)}`
          : null
      }
      rows={response ? compareRows(response, compare) : []}
      compareOptions={earlier.map((r) => ({
        id: r.id,
        label: shortDate(r.submittedAt),
      }))}
      compareId={compare?.id ?? null}
      onCompare={setPicked}
      compareLabel={compare ? shortDate(compare.submittedAt) : null}
      reply={reply}
      onReply={setReply}
      existingReply={response?.replyText ?? null}
      canMarkReviewed={response !== null && response.reviewedAt === null}
      onMarkReviewed={() => void review()}
      onSendReply={() => void review(reply)}
      offline={!online}
      onBack={() => router.back()}
    />
  );
}

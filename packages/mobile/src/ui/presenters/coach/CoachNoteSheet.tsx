import { useCallback, useEffect, useState } from "react";
import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { useCoachNoteSheet } from "@/state/coach-note-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <CoachNoteSheet> — add / edit / delete a private coach note for a client
 * (M8 Coach Phase 12). Root-mounted; opened from Client Detail's Notes card.
 *
 *  - create mode (`editNote === null`): `POST /trainers/me/clients/:id/notes`.
 *  - edit mode (`editNote` set): `PUT …/:noteId` (Save) or `DELETE …/:noteId`.
 *
 * Content-only composer — the prototype's note rows are date + body, no title,
 * so `title` is sent empty and `noteType` defaults server-side. ONLINE-ONLY
 * (direct adapter call, never the sync queue — mirrors the other coach writes);
 * the container refreshes the aggregate on `onSaved` so the card re-reads.
 */
export function CoachNoteSheet() {
  const open = useCoachNoteSheet((s) => s.open);
  const clientId = useCoachNoteSheet((s) => s.clientId);
  const editNote = useCoachNoteSheet((s) => s.editNote);
  const onSaved = useCoachNoteSheet((s) => s.onSaved);
  const closeSheet = useCoachNoteSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const isEdit = editNote !== null;

  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setContent("");
      setError(null);
      setSubmitting(false);
      setDeleting(false);
      return;
    }
    setContent(editNote?.content ?? "");
    setError(null);
    setSubmitting(false);
    setDeleting(false);
  }, [open, editNote]);

  const trimmed = content.trim();
  const busy = submitting || deleting;
  const canSave = clientId !== null && trimmed !== "" && !busy;

  const handleSave = useCallback(async () => {
    if (!canSave || clientId === null) return;
    setError(null);
    setSubmitting(true);
    const result =
      isEdit && editNote
        ? await api.updateClientNote(clientId, editNote.noteId, {
            content: trimmed,
          })
        : await api.createClientNote(clientId, { content: trimmed });
    setSubmitting(false);
    if (result.ok) {
      onSaved?.();
      closeSheet();
      return;
    }
    setError("Couldn’t save the note. Please try again.");
  }, [api, canSave, clientId, isEdit, editNote, trimmed, onSaved, closeSheet]);

  const handleDelete = useCallback(async () => {
    if (clientId === null || !editNote || busy) return;
    setError(null);
    setDeleting(true);
    const result = await api.deleteClientNote(clientId, editNote.noteId);
    setDeleting(false);
    if (result.ok) {
      onSaved?.();
      closeSheet();
      return;
    }
    setError("Couldn’t delete the note. Please try again.");
  }, [api, clientId, editNote, busy, onSaved, closeSheet]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title={isEdit ? "Edit note" : "Add a note"}
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="coach-note-sheet">
        <View gap={8}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            Note
          </Text>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="Private note about this client…"
            placeholderTextColor="#8A8A98"
            multiline
            autoCorrect
            testID="coach-note-content"
            style={{
              minHeight: 120,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#232735",
              backgroundColor: "#1A1D29",
              paddingHorizontal: 14,
              paddingTop: 12,
              paddingBottom: 12,
              color: "#F4F4F8",
              fontSize: 14,
              textAlignVertical: "top",
            }}
          />
        </View>

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="coach-note-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canSave}
          onPress={handleSave}
          testID="coach-note-submit"
        >
          {submitting ? "Saving…" : isEdit ? "Save note" : "Add note"}
        </Btn>

        {isEdit ? (
          <Btn
            variant="soft"
            tone="ember"
            disabled={busy}
            onPress={handleDelete}
            testID="coach-note-delete"
          >
            {deleting ? "Deleting…" : "Delete note"}
          </Btn>
        ) : null}
      </View>
    </BottomSheet>
  );
}

import { Modal } from "react-native";
import { useDiscardConfirmation } from "@/state/discard-workout";
import { EndConfirmDialogPresenter } from "@/ui/presenters/EndConfirmDialogPresenter";

export function DiscardWorkoutConfirmationContainer() {
  const request = useDiscardConfirmation((s) => s.request);
  const close = () => {
    if (request) useDiscardConfirmation.getState().close(request);
  };
  return (
    <Modal
      visible={!!request}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <EndConfirmDialogPresenter
        elapsed=""
        variant="discard"
        testID="discard-workout-dialog"
        onKeepGoing={close}
        onEnd={() => {
          if (!request || useDiscardConfirmation.getState().request !== request)
            return;
          close();
          request.onConfirm();
        }}
      />
    </Modal>
  );
}

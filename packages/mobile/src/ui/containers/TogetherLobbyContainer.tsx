import { AppState } from "react-native";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View, Text } from "@tamagui/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  TogetherLobbyPresenter,
  type TogetherLobbyScreen,
} from "@/ui/presenters/TogetherLobbyPresenter";

/** Mounted only by the disabled-by-default capability. Signing keys stay in the adapter. */
export function TogetherLobbyContainer({
  lobby,
  workoutName,
  accountId,
  children,
}: {
  lobby: TogetherLobbyPort;
  workoutName: string;
  accountId: string;
  children?: (row: ReactNode) => ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    (listener) => lobby.subscribe(listener),
    () => lobby.getSnapshot(),
  );
  const [screen, setScreen] = useState<TogetherLobbyScreen>("start");
  const [visible, setVisible] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const generation = useRef(0);
  const scanned = useRef(false);
  const dismiss = () => {
    generation.current++;
    setVisible(false);
    setScanning(false);
    setCode("");
    setNotice("");
  };
  const close = () => {
    dismiss();
    void lobby.cancel().catch(() => {});
  };
  useEffect(() => {
    const lifetime = generation;
    generation.current++;
    setVisible(false);
    setScanning(false);
    setCode("");
    setNotice("");
    return () => {
      lifetime.current++;
      void lobby.cancel().catch(() => {});
    };
  }, [accountId, lobby]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        generation.current++;
        setVisible(false);
        setScanning(false);
        setCode("");
        setNotice("");
      }
    });
    return () => listener.remove();
  }, []);
  // Camera never stays active after selecting or losing authorization.
  useEffect(() => {
    if (snapshot.phase !== "idle") {
      generation.current++;
      setScanning(false);
      setCode("");
    }
  }, [snapshot.phase]);
  const invoke = (action: () => Promise<void>) => {
    const current = generation.current;
    setNotice("");
    void action().catch(() => {
      if (current === generation.current)
        setNotice(
          "Could not complete this action. Your personal workout is safe.",
        );
    });
  };
  const scan = () => {
    const current = generation.current;
    invoke(async () => {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (current !== generation.current) return;
      if (!result.granted) {
        setNotice(
          "Camera permission is unavailable. Paste the invitation instead.",
        );
        return;
      }
      scanned.current = false;
      setScanning(true);
    });
  };
  if (snapshot.phase === "disabled") return children?.(null) ?? null;
  const row = (
    <View
      minHeight={44}
      flexDirection="row"
      alignItems="center"
      gap={8}
      paddingHorizontal={16}
      backgroundColor="$surface"
      testID="together-workout-row"
    >
      <Text flex={1} fontFamily="$body" fontSize={12} color="$text2">
        {snapshot.phase === "idle"
          ? "Train together · your sets stay yours"
          : "Together · lobby"}
      </Text>
      <Btn
        size="sm"
        variant="soft"
        onPress={() => {
          setScreen("start");
          setVisible(true);
        }}
      >
        {" "}
        {snapshot.phase === "idle" ? "Start" : "Open"}{" "}
      </Btn>
      {snapshot.phase === "idle" && (
        <Btn
          size="sm"
          variant="ghost"
          onPress={() => {
            setScreen("join");
            setVisible(true);
          }}
        >
          Join
        </Btn>
      )}
    </View>
  );
  return (
    <>
      {children ? children(row) : row}
      <BottomSheet
        visible={visible}
        onClose={dismiss}
        title={
          snapshot.phase === "selected"
            ? "Join this workout"
            : screen === "join"
              ? "Join a session"
              : "Train together"
        }
        eyebrow="TRAIN TOGETHER"
        height="tall"
      >
        <TogetherLobbyPresenter
          snapshot={snapshot}
          screen={screen}
          code={code}
          notice={notice}
          workoutName={workoutName}
          onCodeChange={setCode}
          onHost={() => invoke(() => lobby.host(workoutName))}
          onSelect={() => invoke(() => lobby.selectInvite(code))}
          onJoin={() => invoke(() => lobby.join())}
          onScan={scan}
          onCopy={() =>
            invoke(async () => {
              await Clipboard.setStringAsync(snapshot.invitation!);
            })
          }
          onReconnect={() => invoke(() => lobby.reconnect())}
          onCancel={close}
          onApprove={(peerId) => invoke(() => lobby.approve(peerId))}
          onDecline={(peerId) => invoke(() => lobby.decline(peerId))}
          qr={
            snapshot.invitation ? (
              <View padding={12} backgroundColor="white">
                <QRCode value={snapshot.invitation} size={180} />
              </View>
            ) : undefined
          }
          scanner={
            scanning ? (
              <CameraView
                testID="together-qr-camera"
                style={{ height: 220 }}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  if (scanned.current) return;
                  scanned.current = true;
                  setScanning(false);
                  setCode(data);
                  invoke(() => lobby.selectInvite(data));
                }}
              />
            ) : undefined
          }
        />
      </BottomSheet>
    </>
  );
}

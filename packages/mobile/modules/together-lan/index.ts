import { requireOptionalNativeModule } from "expo";

export type TogetherLanEvent =
  | { type: "discovered"; endpointId: string; lobbyId: string }
  | { type: "lost"; endpointId: string }
  | { type: "connected"; peerId: string; incoming: boolean }
  | { type: "frame"; peerId: string; frame: string }
  | { type: "disconnected"; peerId: string }
  | { type: "error"; code: string; peerId?: string };

/** Raw, untrusted bytes. Anonymous probes carry public metadata only; admission and workout traffic require the authenticated channel. */
export interface TogetherLanNative {
  startHost(lobbyId: string): Promise<void>;
  startDiscovery(): Promise<void>;
  connect(endpointId: string): Promise<void>;
  send(peerId: string, frame: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: "onEvent",
    listener: (event: TogetherLanEvent) => void,
  ): { remove(): void };
}

// Old builds and Expo Go must remain usable while Together is disabled.
export const togetherLan = requireOptionalNativeModule<
  TogetherLanNative & {
    startHotspotHost?(lobbyId: string): Promise<void>;
    startHotspotDiscovery?(): Promise<void>;
  }
>("TogetherLan");

/** Explicit Android AP-owner mode; never an automatic fallback from ordinary Wi-Fi. */
export const togetherHotspotOwner: TogetherLanNative | null =
  togetherLan?.startHotspotHost && togetherLan.startHotspotDiscovery
    ? {
        startHost: (id) => togetherLan.startHotspotHost!(id),
        startDiscovery: () => togetherLan.startHotspotDiscovery!(),
        connect: (id) => togetherLan.connect(id),
        send: (id, frame) => togetherLan.send(id, frame),
        disconnect: (id) => togetherLan.disconnect(id),
        stop: () => togetherLan.stop(),
        addListener: (name, listener) =>
          togetherLan.addListener(name, listener),
      }
    : null;

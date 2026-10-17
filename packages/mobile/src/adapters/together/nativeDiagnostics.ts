import type {
  TogetherLanEvent,
  TogetherLanNative,
} from "../../../modules/together-lan";
import type { TogetherLogSink } from "@/diagnostics/together/togetherLog";
import { togetherErrorCode, togetherErrorMessage } from "./errorCode";

/**
 * Records every native transport call with its outcome and real code, and
 * every native event except frame contents. Native `log` events (SDK detail
 * the Swift/Kotlin modules emit) are recorded here and never reach the
 * session, which only understands transport events.
 */
export function withNativeDiagnostics(
  native: TogetherLanNative,
  log: TogetherLogSink,
  source: string,
  now: () => number = Date.now,
): TogetherLanNative {
  const call = async <T>(
    name: string,
    data: Record<string, unknown>,
    work: () => Promise<T>,
    quiet = false,
  ): Promise<T> => {
    const started = now();
    try {
      const result = await work();
      if (!quiet)
        log.record(source, `${name} ok`, { ...data, ms: now() - started });
      return result;
    } catch (error) {
      log.record(source, `${name} failed`, {
        ...data,
        ms: now() - started,
        code: togetherErrorCode(error),
        message: togetherErrorMessage(error),
      });
      throw error;
    }
  };
  return {
    startHost: (lobbyId) =>
      call("startHost", { lobbyId }, () => native.startHost(lobbyId)),
    startDiscovery: () =>
      call("startDiscovery", {}, () => native.startDiscovery()),
    connect: (endpointId) =>
      call("connect", { endpointId }, () => native.connect(endpointId)),
    // Sends are per protocol message; only failures are worth a line.
    send: (peerId, frame) =>
      call(
        "send",
        { peerId, chars: frame.length },
        () => native.send(peerId, frame),
        true,
      ),
    disconnect: (peerId) =>
      call("disconnect", { peerId }, () => native.disconnect(peerId)),
    stop: () => call("stop", {}, () => native.stop()),
    addListener(name, listener) {
      return native.addListener(name, (event: TogetherLanEvent) => {
        if (event.type === "log") {
          log.record(source, event.message, event.data);
          return;
        }
        if (event.type !== "frame") {
          const { type, ...rest } = event;
          log.record(source, `event ${type}`, rest);
        }
        listener(event);
      });
    },
  };
}

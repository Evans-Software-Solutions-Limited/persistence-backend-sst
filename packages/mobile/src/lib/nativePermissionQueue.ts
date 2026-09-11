import { AppState, Platform } from "react-native";

// Native permission sheets cannot overlap on iOS. Keep this queue shared by
// every caller, including startup and later push-token registration.
let permissionQueue: Promise<void> = Promise.resolve();

function abortError(): Error {
  const error = new Error("Permission request aborted");
  error.name = "AbortError";
  return error;
}

function waitUntilActive(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const cleanup = () => {
      clearTimer();
      subscription.remove();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const onChange = () => {
      clearTimer();
      if (AppState.currentState === "active") {
        // Allow the previous native sheet to finish dismissing. Any lifecycle
        // transition restarts the full stabilization interval.
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, 300);
      }
    };
    const subscription = AppState.addEventListener("change", onChange);
    signal?.addEventListener("abort", onAbort, { once: true });
    onChange();
  });
}

/** Serialize iOS prompts and wait for an active, settled app before each one. */
export function runNativePermissionRequest<T>(
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (Platform.OS !== "ios") {
    try {
      return request();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const job = permissionQueue.then(async () => {
    if (signal?.aborted) throw abortError();
    await waitUntilActive(signal);
    if (signal?.aborted) throw abortError();
    return request();
  });
  // Aborting the caller cannot dismiss an already-open native sheet. The
  // queue remains occupied until the native operation itself settles.
  permissionQueue = job.then(
    () => undefined,
    () => undefined,
  );

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    job.then(
      (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

import type { TogetherLanNative, TogetherLanEvent } from "../together-lan";

const encoder = new TextEncoder();
const maximum = 65536;
/** BYTES payloads are ordered by Nearby. Limit each packet below both SDKs' 32K ceiling. */
export function frameNearby(raw: TogetherLanNative): TogetherLanNative {
  let generation = 0;
  const incoming = new Map<
    string,
    {
      parts: string[];
      total: number;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const outgoing = new Map<string, { queue: Promise<void>; count: number }>();
  const clear = (id: string) => {
    const frame = incoming.get(id);
    if (frame) clearTimeout(frame.timer);
    incoming.delete(id);
    outgoing.delete(id);
  };
  const disconnect = async (id: string) => {
    clear(id);
    await raw.disconnect(id);
  };
  return {
    startHost: (id) => raw.startHost(id),
    startDiscovery: () => raw.startDiscovery(),
    connect: (id) => raw.connect(id),
    disconnect,
    async stop() {
      generation++;
      for (const id of incoming.keys()) clear(id);
      outgoing.clear();
      await raw.stop();
    },
    send(id, frame) {
      const size = encoder.encode(frame).length;
      if (!size || size > maximum)
        return Promise.reject(new Error("frame_limit"));
      let state = outgoing.get(id);
      if (!state) {
        state = { queue: Promise.resolve(), count: 0 };
        outgoing.set(id, state);
      }
      if (state.count >= 16)
        return Promise.reject(new Error("frame_queue_full"));
      state.count++;
      const token = generation;
      const current = state;
      const sent = current.queue.then(async () => {
        const total = Math.ceil(frame.length / 4096);
        for (let index = 0; index < total; index++) {
          if (token !== generation || outgoing.get(id) !== current)
            throw new Error("cancelled");
          await raw.send(
            id,
            JSON.stringify({
              v: 1,
              index,
              total,
              data: frame.slice(index * 4096, (index + 1) * 4096),
            }),
          );
        }
      });
      current.queue = sent
        .catch(async () => {
          if (token === generation && outgoing.get(id) === current)
            await disconnect(id).catch(() => {});
        })
        .finally(() => {
          current.count--;
        });
      return sent;
    },
    addListener(_name, listener) {
      const token = generation;
      const fail = (id: string) => {
        clear(id);
        listener({ type: "error", peerId: id, code: "invalid_frame" });
        void raw.disconnect(id).catch(() => {});
      };
      const sub = raw.addListener("onEvent", (event: TogetherLanEvent) => {
        if (token !== generation) return;
        if (event.type === "disconnected") clear(event.peerId);
        if (event.type !== "frame") {
          listener(event);
          return;
        }
        try {
          if (encoder.encode(event.frame).length > 32768) throw new Error();
          const p = JSON.parse(event.frame);
          if (
            !p ||
            Object.keys(p).sort().join() !== "data,index,total,v" ||
            p.v !== 1 ||
            !Number.isInteger(p.index) ||
            !Number.isInteger(p.total) ||
            p.total < 1 ||
            p.total > 16 ||
            typeof p.data !== "string" ||
            p.data.length < 1 ||
            p.data.length > 4096
          )
            throw new Error();
          let frame = incoming.get(event.peerId);
          if (!frame) {
            if (p.index !== 0 || incoming.size >= 8) throw new Error();
            const timer = setTimeout(() => fail(event.peerId), 10000);
            frame = { parts: [], total: p.total, timer };
            incoming.set(event.peerId, frame);
          }
          if (p.index !== frame.parts.length || p.total !== frame.total)
            throw new Error();
          frame.parts.push(p.data);
          if (frame.parts.length === frame.total) {
            const wire = frame.parts.join("");
            clearTimeout(frame.timer);
            incoming.delete(event.peerId);
            if (encoder.encode(wire).length > maximum) throw new Error();
            listener({ ...event, frame: wire });
          }
        } catch {
          fail(event.peerId);
        }
      });
      return {
        remove() {
          sub.remove();
          for (const id of incoming.keys()) clear(id);
          outgoing.clear();
        },
      };
    },
  };
}

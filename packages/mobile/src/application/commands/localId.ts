/**
 * Optimistic local id generator for offline-first commands. Rows created
 * offline carry a `local-…` id until the sync worker (or the next list
 * refresh) reconciles them with the server-assigned id. Centralised so the
 * dozen mutation hooks don't each re-declare the same factory.
 */
export const localIdFactory = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

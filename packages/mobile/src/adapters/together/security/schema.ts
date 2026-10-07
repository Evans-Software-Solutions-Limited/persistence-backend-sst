// Wire-shape mirror of core/application/together/offlineTypes.ts. Keep strict:
// unknown properties are rejected before a signed envelope is interpreted.
type RecordValue = Record<string, unknown>;
export function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is RecordValue {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    required.every((k) => Object.hasOwn(value, k)) &&
    Object.keys(value).every(
      (k) => required.includes(k) || optional.includes(k),
    )
  );
}
export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}
export function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function keyId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
export function signed(
  value: unknown,
  payload: (p: unknown) => boolean,
): boolean {
  return (
    object(value, ["payload", "signature"]) &&
    typeof value.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(value.signature) &&
    payload(value.payload)
  );
}
function credential(value: unknown) {
  return (
    object(value, [
      "kind",
      "keyId",
      "userId",
      "deviceId",
      "publicKey",
      "issuedAt",
      "expiresAt",
    ]) &&
    value.kind === "together-device-v1" &&
    keyId(value.keyId) &&
    uuid(value.userId) &&
    uuid(value.deviceId) &&
    typeof value.publicKey === "string" &&
    value.publicKey.length >= 1 &&
    value.publicKey.length <= 2048 &&
    integer(value.issuedAt) &&
    integer(value.expiresAt)
  );
}
function friendship(value: unknown) {
  return (
    object(value, ["kind", "keyId", "users", "issuedAt", "expiresAt"]) &&
    value.kind === "together-friendship-v1" &&
    keyId(value.keyId) &&
    Array.isArray(value.users) &&
    value.users.length === 2 &&
    value.users.every(uuid) &&
    integer(value.issuedAt) &&
    integer(value.expiresAt)
  );
}
function consent(value: unknown) {
  return (
    object(value, [
      "kind",
      "sessionId",
      "hostUserId",
      "hostDeviceId",
      "userId",
      "deviceId",
      "executionId",
      "nonce",
      "consentVersion",
      "consentAccepted",
    ]) &&
    value.kind === "together-consent-v1" &&
    value.consentVersion === "together-v1" &&
    value.consentAccepted === true &&
    [
      "sessionId",
      "hostUserId",
      "hostDeviceId",
      "userId",
      "deviceId",
      "executionId",
      "nonce",
    ].every((k) => uuid(value[k]))
  );
}
function member(value: unknown) {
  return (
    object(value, ["credential", "consent", "admission"], ["friendship"]) &&
    signed(value.credential, credential) &&
    signed(value.consent, consent) &&
    ["host", "friend", "approved"].includes(value.admission as string) &&
    (!Object.hasOwn(value, "friendship") ||
      signed(value.friendship, friendship))
  );
}
function roster(value: unknown) {
  return (
    object(
      value,
      [
        "kind",
        "sessionId",
        "hostUserId",
        "hostDeviceId",
        "revision",
        "previousHash",
        "members",
      ],
      ["audience"],
    ) &&
    (!Object.hasOwn(value, "audience") || value.audience === "friends") &&
    value.kind === "together-roster-v1" &&
    uuid(value.sessionId) &&
    uuid(value.hostUserId) &&
    uuid(value.hostDeviceId) &&
    integer(value.revision) &&
    value.revision >= 1 &&
    (value.previousHash === null || hash(value.previousHash)) &&
    Array.isArray(value.members) &&
    value.members.length >= 1 &&
    value.members.length <= 4 &&
    value.members.every(member)
  );
}
export const credentialValidator = {
  Check: (value: unknown) => signed(value, credential),
};
export const rosterValidator = {
  Check: (value: unknown) => signed(value, roster),
};

export const friendshipValidator = {
  Check: (value: unknown) => signed(value, friendship),
};

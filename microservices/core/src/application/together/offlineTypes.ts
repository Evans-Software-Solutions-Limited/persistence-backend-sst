import { TypeCompiler } from "elysia/type-system";
import { t } from "elysia";
import { planSchema, commandSchema } from "./types";
export const offlineUuidSchema = t.String({
  pattern:
    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});
const uuid = offlineUuidSchema;
const publicKey = t.String({ minLength: 1, maxLength: 2048 });
const keyId = t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" });
const timestamp = t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const signedCredentialSchema = t.Object(
  {
    payload: t.Object(
      {
        kind: t.Literal("together-device-v1"),
        keyId,
        userId: uuid,
        deviceId: uuid,
        publicKey,
        issuedAt: timestamp,
        expiresAt: timestamp,
      },
      { additionalProperties: false },
    ),
    signature: t.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  },
  { additionalProperties: false },
);
export const registrationSchema = t.Object(
  {
    payload: t.Object(
      {
        kind: t.Literal("together-register-v1"),
        userId: uuid,
        deviceId: uuid,
        publicKey,
        requestId: uuid,
        timestamp,
      },
      { additionalProperties: false },
    ),
    signature: t.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  },
  { additionalProperties: false },
);
export const friendshipSchema = t.Object(
  {
    payload: t.Object(
      {
        kind: t.Literal("together-friendship-v1"),
        keyId,
        users: t.Tuple([uuid, uuid]),
        issuedAt: timestamp,
        expiresAt: timestamp,
      },
      { additionalProperties: false },
    ),
    signature: t.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  },
  { additionalProperties: false },
);
const consentSchema = t.Object(
  {
    payload: t.Object(
      {
        kind: t.Literal("together-consent-v1"),
        sessionId: uuid,
        hostUserId: uuid,
        hostDeviceId: uuid,
        userId: uuid,
        deviceId: uuid,
        executionId: uuid,
        nonce: uuid,
        consentVersion: t.Literal("together-v1"),
        consentAccepted: t.Literal(true),
      },
      { additionalProperties: false },
    ),
    signature: t.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  },
  { additionalProperties: false },
);
export const rosterSchema = t.Object(
  {
    payload: t.Object(
      {
        kind: t.Literal("together-roster-v1"),
        audience: t.Optional(t.Literal("friends")),
        sessionId: uuid,
        hostUserId: uuid,
        hostDeviceId: uuid,
        revision: t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        previousHash: t.Union([
          t.Null(),
          t.String({ pattern: "^[a-f0-9]{64}$" }),
        ]),
        members: t.Array(
          t.Object(
            {
              credential: signedCredentialSchema,
              consent: consentSchema,
              admission: t.Union([
                t.Literal("host"),
                t.Literal("friend"),
                t.Literal("approved"),
              ]),
              friendship: t.Optional(friendshipSchema),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 4 },
        ),
      },
      { additionalProperties: false },
    ),
    signature: t.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  },
  { additionalProperties: false },
);
// Only personal operations; plan is immutable for this recovery contract.
const ownOperation = t.Union(
  commandSchema.properties.operation.anyOf
    .filter((schema) => schema.properties.type.const !== "replacePlan")
    .map((schema) =>
      t.Object(
        {
          ...schema.properties,
          ...("planExerciseId" in schema.properties
            ? { planExerciseId: uuid }
            : {}),
          ...("exerciseId" in schema.properties
            ? { exerciseId: t.Union([uuid, t.Null()]) }
            : {}),
          ...("setId" in schema.properties ? { setId: uuid } : {}),
          ...("set" in schema.properties
            ? {
                set: t.Object(
                  { ...schema.properties.set.properties, setId: uuid },
                  { additionalProperties: false },
                ),
              }
            : {}),
        },
        { additionalProperties: false },
      ),
    ),
);
export const recoveryUploadSchema = t.Object(
  {
    credential: signedCredentialSchema,
    sessionId: uuid,
    executionId: uuid,
    startedAt: timestamp,
    plan: t.Object(
      {
        ...planSchema.properties,
        exercises: t.Array(
          t.Object(
            {
              ...planSchema.properties.exercises.items.properties,
              planExerciseId: uuid,
              exerciseId: uuid,
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 100 },
        ),
      },
      { additionalProperties: false },
    ),
    commands: t.Array(
      t.Object(
        {
          payload: t.Object(
            {
              kind: t.Literal("together-recovery-v1"),
              userId: uuid,
              sessionId: uuid,
              executionId: uuid,
              commandId: uuid,
              planHash: t.String({ pattern: "^[a-f0-9]{64}$" }),
              startedAt: timestamp,
              expectedVersion: t.Integer({
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
              }),
              operation: ownOperation,
            },
            { additionalProperties: false },
          ),
          signature: t.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);

export const credentialValidator = TypeCompiler.Compile(signedCredentialSchema);
export const rosterValidator = TypeCompiler.Compile(rosterSchema);
export const registrationValidator = TypeCompiler.Compile(registrationSchema);
export const recoveryValidator = TypeCompiler.Compile(recoveryUploadSchema);

export const offlineUuidValidator = TypeCompiler.Compile(offlineUuidSchema);

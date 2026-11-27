import type { ClientPhotoSet } from "../photos/types";

/** PER-138 fixtures: a ready set with all three poses. */
export function photoSet(
  id: string,
  takenOn: string,
  over: Partial<ClientPhotoSet> = {},
): ClientPhotoSet {
  return {
    id,
    takenOn,
    source: "self",
    status: "ready",
    createdAt: `${takenOn}T08:00:00.000Z`,
    updatedAt: `${takenOn}T08:00:00.000Z`,
    photos: (["front", "side", "back"] as const).map((pose) => ({
      id: `${id}-${pose}`,
      pose,
      bytes: 1000,
      width: 1536,
      height: 2048,
      url: `https://media.example/${id}/${pose}.jpg?sig=1`,
      expiresAt: "2099-01-01T00:00:00.000Z",
    })),
    weight: null,
    bodyFat: null,
    ...over,
  };
}

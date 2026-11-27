import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ClientPage } from "../clients/ClientPage";
import {
  PHOTOS_REFRESH_MS,
  PhotosApiContext,
  photosKey,
  type PhotosApi,
} from "../photos/api";
import { clearPhotoCache } from "../photos/usePhotoSrc";
import type { ClientPhotos } from "../photos/types";
import {
  CLIENT_ID,
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";
import { photoSet } from "./photosFixtures";

const PATH = "/coach/clients/:clientId/:tab?";
const ROUTE = `/coach/clients/${CLIENT_ID}/photos`;

const CANVAS: ClientPhotos = {
  asOf: "2026-10-27T09:00:00.000Z",
  sets: [
    photoSet("s26", "2026-10-26", {
      weight: { kg: 82.4, measuredAt: "2026-10-26T07:00:00.000Z" },
      bodyFat: { percentage: 14.5, measuredAt: "2026-10-26T07:00:00.000Z" },
    }),
    photoSet("s19", "2026-10-19", {
      weight: { kg: 82.0, measuredAt: "2026-10-19T07:00:00.000Z" },
    }),
    photoSet("s12", "2026-10-12"),
    photoSet("s05", "2026-10-05"),
    photoSet("s28", "2026-09-28"),
    photoSet("s15", "2026-09-15", {
      weight: { kg: 80.2, measuredAt: "2026-09-15T07:00:00.000Z" },
      bodyFat: { percentage: 15.2, measuredAt: "2026-09-15T07:00:00.000Z" },
    }),
  ],
};

function open(clientPhotos: PhotosApi["clientPhotos"]) {
  const photos = { clientPhotos: vi.fn(clientPhotos) };
  const utils = renderCoach(
    <PhotosApiContext.Provider value={photos}>
      <ClientPage />
    </PhotosApiContext.Provider>,
    { route: ROUTE, path: PATH, api: fakeApi() },
  );
  return { ...utils, photos };
}

/** The image inside a labelled tile, if it has loaded. */
const imgIn = (label: string, nth = 0) =>
  screen.getAllByRole("img", { name: label })[nth]!.querySelector("img");

const strip = () => document.querySelector(".photos-strip")?.textContent;

type FakeResponse = { ok: boolean; status: number; blob: () => Promise<Blob> };
let fetchMock: Mock<() => Promise<FakeResponse>>;

beforeEach(() => {
  setOnline(true);
  clearPhotoCache();
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:photo-${++n}`);
  URL.revokeObjectURL = vi.fn();
  fetchMock = vi.fn(
    async (): Promise<FakeResponse> => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["jpg"]),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setOnline(true);
});

describe("Client → Photos (C3.4a)", () => {
  it("shows sets by date and compares the first and latest front photos", async () => {
    const { photos } = open(async () => CANVAS);
    expect(await screen.findByText("6 sets · every 1–2 weeks")).toBeTruthy();
    expect(photos.clientPhotos).toHaveBeenCalledWith(CLIENT_ID);
    expect(
      screen.getByRole("tab", { name: "Photos" }).getAttribute("aria-selected"),
    ).toBe("true");
    const grid = screen.getByRole("region", { name: "Photo sets" });
    for (const d of [
      "26 Oct",
      "19 Oct",
      "12 Oct",
      "5 Oct",
      "28 Sep",
      "15 Sep",
    ]) {
      expect(within(grid).getByText(d)).toBeTruthy();
    }
    expect(within(grid).getAllByRole("img", { name: "Front" })).toHaveLength(6);
    // The compared sets are marked.
    expect(
      screen
        .getByRole("button", { name: "26 Oct: compare with the latest" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "15 Sep: compare with the latest" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const cmp = screen.getByRole("region", { name: "Compare" });
    expect(
      within(cmp).getByRole("img", { name: "Front · 15 Sep" }),
    ).toBeTruthy();
    expect(
      within(cmp).getByRole("img", { name: "Front · 26 Oct" }),
    ).toBeTruthy();
    expect(within(cmp).getByText("80.2")).toBeTruthy();
    expect(within(cmp).getByText("→82.4")).toBeTruthy();
    expect(within(cmp).getByText("15.2")).toBeTruthy();
    expect(within(cmp).getByText("→14.5")).toBeTruthy();
    expect(within(cmp).getByText("6")).toBeTruthy();
    expect(within(cmp).getByText("wk")).toBeTruthy();
    // Images load once by photo id, from the view link, as cached copies.
    await waitFor(() =>
      expect(imgIn("Front · 26 Oct")?.getAttribute("src")).toMatch(/^blob:/),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://media.example/s26/front.jpg?sig=1",
    );
  });

  it("switches pose, picks any two dates, and wipes between them", async () => {
    open(async () => CANVAS);
    await screen.findByText("6 sets · every 1–2 weeks");
    fireEvent.click(screen.getByRole("tab", { name: "Side" }));
    expect(screen.getByRole("img", { name: "Side · 15 Sep" })).toBeTruthy();

    // A set compares with the latest.
    fireEvent.click(
      screen.getByRole("button", { name: "19 Oct: compare with the latest" }),
    );
    expect(screen.getByRole("img", { name: "Side · 19 Oct" })).toBeTruthy();
    expect(strip()).toBe("82.0→82.4Weight kg–→14.5Body fat %1wkApart");

    // Any two dates from the dropdowns, each without the other's date.
    const earlier = screen.getByLabelText("Earlier date") as HTMLSelectElement;
    expect(
      within(earlier).queryByRole("option", { name: "26 Oct" }),
    ).toBeNull();
    fireEvent.change(earlier, { target: { value: "s28" } });
    fireEvent.change(screen.getByLabelText("Later date"), {
      target: { value: "s12" },
    });
    expect(screen.getByRole("img", { name: "Side · 28 Sep" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Side · 12 Oct" })).toBeTruthy();
    expect(strip()).toBe("–→–Weight kg–→–Body fat %2wkApart");

    // The latest itself goes back to first vs latest.
    fireEvent.click(
      screen.getByRole("button", { name: "26 Oct: compare with the latest" }),
    );
    expect(screen.getByRole("img", { name: "Side · 15 Sep" })).toBeTruthy();

    // Wipe: the earlier photo is clipped at the slider.
    fireEvent.change(screen.getByLabelText("Compare view"), {
      target: { value: "wipe" },
    });
    const slider = screen.getByLabelText("Wipe between 15 Sep and 26 Oct");
    fireEvent.change(slider, { target: { value: "30" } });
    const olderTile = screen.getByRole("img", { name: "Side · 15 Sep" });
    expect((olderTile.parentElement as HTMLElement).style.clipPath).toBe(
      "inset(0 70% 0 0)",
    );
    fireEvent.change(screen.getByLabelText("Compare view"), {
      target: { value: "side" },
    });
    expect(screen.queryByLabelText(/Wipe between/)).toBeNull();
  });

  it("with one set shows it and says compare needs two dates", async () => {
    open(async () => ({ ...CANVAS, sets: [CANVAS.sets[0]!] }));
    expect(await screen.findByText("1 set")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Front · 26 Oct" })).toBeTruthy();
    expect(
      screen.getByText("Compare needs two dates. Sam has one set so far."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Compare view")).toBeNull();
  });

  it("no photos yet", async () => {
    open(async () => ({ asOf: CANVAS.asOf, sets: [] }));
    expect(await screen.findByText("No photos yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Sam's front, side and back photos show here by date once they add some.",
      ),
    ).toBeTruthy();
  });

  it("the client hasn't shared photos yet", async () => {
    open(async () => {
      throw apiError(403, { code: "photo_sharing_not_granted" });
    });
    expect(
      await screen.findByText("Sam hasn't shared photos with you"),
    ).toBeTruthy();
  });

  it("the photos switch is off, with a way to settings", async () => {
    open(async () => {
      throw apiError(403, { code: "photos_off" });
    });
    expect(await screen.findByText("Photos are off for Sam")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Open settings" }));
    expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}/settings`);
  });

  it("coaching ended replaces photos already shown", async () => {
    let ended = false;
    const { queryClient } = open(async () => {
      if (ended) throw apiError(403, { code: "not_your_client" });
      return CANVAS;
    });
    await screen.findByText("6 sets · every 1–2 weeks");
    ended = true;
    await queryClient.refetchQueries({ queryKey: photosKey(CLIENT_ID) });
    expect(await screen.findByText("Coaching has ended")).toBeTruthy();
    expect(
      screen.getByText("You can no longer see Sam's photos."),
    ).toBeTruthy();
    expect(screen.queryByText("6 sets · every 1–2 weeks")).toBeNull();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("offline: keeps what was loaded, with the images already viewed", async () => {
    let offline = false;
    const { queryClient } = open(async () => {
      if (offline) throw apiError(0, null, true);
      return CANVAS;
    });
    await screen.findByText("6 sets · every 1–2 weeks");
    await waitFor(() =>
      expect(imgIn("Front · 26 Oct")?.getAttribute("src")).toMatch(/^blob:/),
    );
    offline = true;
    setOnline(false);
    await queryClient.refetchQueries({ queryKey: photosKey(CLIENT_ID) });
    expect(
      await screen.findByText(/Offline · showing Sam's photos as of/),
    ).toBeTruthy();
    expect(imgIn("Front · 26 Oct")?.getAttribute("src")).toMatch(/^blob:/);
  });

  it("offline with nothing loaded, and other failures, can be retried", async () => {
    setOnline(false);
    let calls = 0;
    open(async () => {
      calls += 1;
      if (calls === 1) throw apiError(0, null, true);
      if (calls === 2) throw apiError(500, { message: "boom" });
      return CANVAS;
    });
    expect(
      await screen.findByText(
        "You're offline. Sam's photos load when you're back online.",
      ),
    ).toBeTruthy();
    setOnline(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("We couldn't load Sam's photos."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("6 sets · every 1–2 weeks")).toBeTruthy();
  });

  it("re-reads every 4 minutes so view links stay fresh, keeping images by photo id", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let sig = 1;
    const { photos } = open(async () => ({
      ...CANVAS,
      sets: CANVAS.sets.map((s) => ({
        ...s,
        photos: s.photos.map((p) => ({ ...p, url: `${p.url}&n=${sig}` })),
      })),
    }));
    await screen.findByText("6 sets · every 1–2 weeks");
    await waitFor(() =>
      expect(imgIn("Front · 26 Oct")?.getAttribute("src")).toMatch(/^blob:/),
    );
    const before = imgIn("Front · 26 Oct")?.getAttribute("src");
    const fetched = fetchMock.mock.calls.length;
    sig = 2;
    await vi.advanceTimersByTimeAsync(PHOTOS_REFRESH_MS + 10);
    await waitFor(() => expect(photos.clientPhotos).toHaveBeenCalledTimes(2));
    // Same photo, new link: the cached copy stays and nothing downloads again.
    expect(imgIn("Front · 26 Oct")?.getAttribute("src")).toBe(before);
    expect(fetchMock.mock.calls.length).toBe(fetched);
  });

  it("falls back to the view link when a photo can't be fetched as a file", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 403,
      blob: async () => new Blob([]),
    }));
    open(async () => CANVAS);
    await screen.findByText("6 sets · every 1–2 weeks");
    await waitFor(() =>
      expect(imgIn("Front · 26 Oct")?.getAttribute("src")).toBe(
        "https://media.example/s26/front.jpg?sig=1",
      ),
    );
  });
});

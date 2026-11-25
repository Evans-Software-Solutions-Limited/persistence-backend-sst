import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  AddProgressPhotosPresenter,
  type AddProgressPhotosPresenterProps,
} from "../AddProgressPhotosPresenter";
import {
  ProgressPhotosGalleryPresenter,
  type ProgressPhotosGalleryPresenterProps,
} from "../ProgressPhotosGalleryPresenter";
import {
  ProgressPhotoViewerPresenter,
  type ProgressPhotoViewerPresenterProps,
} from "../ProgressPhotoViewerPresenter";

const tiles = (id: string) =>
  (["Front", "Side", "Back"] as const).map((pose) => ({
    pose,
    uri: `https://view.test/${id}/${pose}.jpg`,
    cacheKey: `${id}-${pose}`,
  }));

describe("ProgressPhotosGalleryPresenter (Y3)", () => {
  const props = (
    over: Partial<ProgressPhotosGalleryPresenterProps> = {},
  ): ProgressPhotosGalleryPresenterProps => ({
    sets: [
      { id: "s1", dateLabel: "25 Oct", detail: "82.4 kg", photos: tiles("s1") },
      { id: "s2", dateLabel: "11 Oct", detail: "81.9 kg", photos: tiles("s2") },
    ],
    pendingWarning: null,
    isRefreshing: false,
    onRefresh: jest.fn(),
    onBack: jest.fn(),
    onAdd: jest.fn(),
    onOpenPhoto: jest.fn(),
    ...over,
  });

  it("lists each date's three photos with its weight, newest first", () => {
    const p = props();
    const s = renderWithTheme(<ProgressPhotosGalleryPresenter {...p} />);
    expect(s.getByText("Gallery")).toBeTruthy();
    expect(s.getByText("Add today's photos")).toBeTruthy();
    expect(s.getByText("25 Oct")).toBeTruthy();
    expect(s.getByText("81.9 kg")).toBeTruthy();
    expect(s.getAllByLabelText(/photo, 25 Oct\. Open/)).toHaveLength(3);
    // Images are cached by photo id, not the expiring link.
    const images = s.getAllByTestId("image");
    expect(images[0]!.props.source).toEqual({
      uri: "https://view.test/s1/Front.jpg",
      cacheKey: "s1-Front",
    });
    expect(images[0]!.props.cachePolicy).toBe("disk");
    expect(s.queryByTestId("photo-gallery-pending-warning")).toBeNull();

    fireEvent.press(s.getByTestId("photo-set-s2-tiles-Side"));
    expect(p.onOpenPhoto).toHaveBeenCalledWith("s2", "Side");
    fireEvent.press(s.getByTestId("photo-gallery-add"));
    fireEvent.press(s.getByTestId("photo-gallery-add-icon"));
    expect(p.onAdd).toHaveBeenCalledTimes(2);
    fireEvent.press(s.getByTestId("photo-gallery-back"));
    expect(p.onBack).toHaveBeenCalled();
  });

  it("warns while sets are still on the phone", () => {
    const s = renderWithTheme(
      <ProgressPhotosGalleryPresenter
        {...props({ pendingWarning: "Could be lost." })}
      />,
    );
    expect(s.getByTestId("photo-gallery-pending-warning")).toBeTruthy();
    expect(s.getByText("Could be lost.")).toBeTruthy();
  });

  it("with no photos shows only Add today's photos", () => {
    const s = renderWithTheme(
      <ProgressPhotosGalleryPresenter {...props({ sets: [] })} />,
    );
    expect(s.getByText("Add today's photos")).toBeTruthy();
    expect(s.queryAllByTestId("image")).toHaveLength(0);
    expect(s.getByTestId("photo-gallery-empty")).toBeTruthy();
    expect(s.getByLabelText("No progress photos yet")).toBeTruthy();
  });
});

describe("AddProgressPhotosPresenter (Y3b)", () => {
  const props = (
    over: Partial<AddProgressPhotosPresenterProps> = {},
  ): AddProgressPhotosPresenterProps => ({
    slots: [
      {
        pose: "front",
        label: "Front",
        photo: { uri: "file:///f.jpg" },
        busy: false,
      },
      { pose: "side", label: "Side", photo: null, busy: true },
      { pose: "back", label: "Back", photo: null, busy: false },
    ],
    dateLabel: "Today, 27 Oct",
    weightLabel: "82.4 kg",
    canSave: false,
    ctaLabel: "Add 2 more to save",
    isSaving: false,
    onBack: jest.fn(),
    onTakePose: jest.fn(),
    onSave: jest.fn(),
    ...over,
  });

  it("shows taken, busy and empty slots, the date, weight and privacy line", () => {
    const p = props();
    const s = renderWithTheme(<AddProgressPhotosPresenter {...p} />);
    expect(s.getByText("Add photos")).toBeTruthy();
    expect(
      s.getByText("Take all three, same spot and light each time."),
    ).toBeTruthy();
    expect(s.getByText("Front ✓")).toBeTruthy();
    expect(s.getByTestId("add-photo-image-front").props.source.uri).toBe(
      "file:///f.jpg",
    );
    expect(s.getByTestId("add-photo-busy-side")).toBeTruthy();
    expect(s.getByText("Tap to take")).toBeTruthy();
    expect(s.getByText("Today, 27 Oct")).toBeTruthy();
    expect(s.getByText("82.4 kg")).toBeTruthy();
    expect(
      s.getByText(
        "Private to you and your coaches. Retake any photo before saving.",
      ),
    ).toBeTruthy();
    expect(s.getByLabelText("Front photo taken. Retake")).toBeTruthy();
    expect(s.getByLabelText("Back photo. Take it")).toBeTruthy();

    fireEvent.press(s.getByTestId("add-photo-slot-back"));
    fireEvent.press(s.getByTestId("add-photo-slot-front"));
    expect(p.onTakePose).toHaveBeenCalledWith("back");
    expect(p.onTakePose).toHaveBeenCalledWith("front");

    // Save waits for all three.
    expect(s.getByText("Add 2 more to save")).toBeTruthy();
    fireEvent.press(s.getByTestId("add-photos-save"));
    expect(p.onSave).not.toHaveBeenCalled();
    fireEvent.press(s.getByTestId("add-photos-back"));
    expect(p.onBack).toHaveBeenCalled();
  });

  it("saves once all three are taken, and shows progress while saving", () => {
    const p = props({ canSave: true, ctaLabel: "Save photos" });
    const s = renderWithTheme(<AddProgressPhotosPresenter {...p} />);
    fireEvent.press(s.getByText("Save photos"));
    expect(p.onSave).toHaveBeenCalled();
    s.rerender(
      <AddProgressPhotosPresenter {...p} isSaving onSave={jest.fn()} />,
    );
    expect(s.queryByText("Save photos")).toBeNull();
  });
});

describe("ProgressPhotoViewerPresenter (Y3c, portrait)", () => {
  const props = (
    over: Partial<ProgressPhotoViewerPresenterProps> = {},
  ): ProgressPhotoViewerPresenterProps => ({
    photo: { uri: "https://view.test/s1/front.jpg", cacheKey: "s1-front" },
    pose: "Front",
    dateLabel: "25 Oct 2026",
    data: [
      { value: "82.4 kg", label: "Weight" },
      { value: "14.8%", label: "Body fat" },
      { value: "Latest", label: "vs latest" },
    ],
    accessibilityLabel: "Front photo, 25 Oct 2026, 82.4 kg",
    open: false,
    dates: [
      { id: "s1", label: "25 Oct 2026", weight: "82.4 kg", selected: true },
      { id: "s2", label: "11 Oct 2026", weight: "81.9 kg", selected: false },
    ],
    onClose: jest.fn(),
    onToggle: jest.fn(),
    onSelectPose: jest.fn(),
    onSelectDate: jest.fn(),
    onAdd: jest.fn(),
    onDelete: jest.fn(),
    ...over,
  });

  it("shows the photo, one pose · date dropdown and the date's numbers", () => {
    const p = props();
    const s = renderWithTheme(<ProgressPhotoViewerPresenter {...p} />);
    expect(s.getByText("Front · 25 Oct 2026")).toBeTruthy();
    expect(s.getByTestId("photo-viewer-image").props.source.cacheKey).toBe(
      "s1-front",
    );
    expect(s.getByTestId("photo-viewer-image").props.contentFit).toBe(
      "contain",
    );
    expect(s.getByLabelText("Front photo, 25 Oct 2026, 82.4 kg")).toBeTruthy();
    expect(s.getByText("14.8%")).toBeTruthy();
    expect(s.getByText("Latest")).toBeTruthy();
    expect(s.queryByTestId("photo-viewer-listbox")).toBeNull();

    fireEvent.press(s.getByTestId("photo-viewer-dropdown"));
    expect(p.onToggle).toHaveBeenCalled();
    fireEvent.press(s.getByTestId("photo-viewer-close"));
    fireEvent.press(s.getByTestId("photo-viewer-add"));
    fireEvent.press(s.getByTestId("photo-viewer-delete"));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onAdd).toHaveBeenCalled();
    expect(p.onDelete).toHaveBeenCalled();
  });

  it("the open dropdown switches pose and date", () => {
    const p = props({ open: true });
    const s = renderWithTheme(<ProgressPhotoViewerPresenter {...p} />);
    expect(s.getByTestId("photo-viewer-listbox")).toBeTruthy();
    expect(s.getByText("11 Oct 2026")).toBeTruthy();
    fireEvent.press(s.getByTestId("photo-viewer-pose-Back"));
    expect(p.onSelectPose).toHaveBeenCalledWith("Back");
    fireEvent.press(s.getByTestId("photo-viewer-date-s2"));
    expect(p.onSelectDate).toHaveBeenCalledWith("s2");
  });

  it("renders without a photo", () => {
    const s = renderWithTheme(
      <ProgressPhotoViewerPresenter {...props({ photo: null })} />,
    );
    expect(s.queryByTestId("photo-viewer-image")).toBeNull();
  });
});

import { Alert } from "react-native";
import { chooseImageSource, pickImage } from "../imagePicker";
import { pickFormPhoto } from "../formPhotoPicker";

jest.mock("../imagePicker", () => ({
  chooseImageSource: jest.fn(),
  pickImage: jest.fn(),
}));

const choose = chooseImageSource as jest.Mock;
const pick = pickImage as jest.Mock;

beforeEach(() => {
  jest.restoreAllMocks();
  choose.mockReset();
  pick.mockReset();
});

describe("pickFormPhoto (the shared picker, PER-130)", () => {
  it("returns the picked photo's file", async () => {
    choose.mockResolvedValue("camera");
    pick.mockResolvedValue({
      status: "picked",
      asset: { uri: "file://a.jpg" },
    });
    await expect(pickFormPhoto()).resolves.toBe("file://a.jpg");
    expect(choose).toHaveBeenCalledWith("Add a photo");
    expect(pick).toHaveBeenCalledWith("camera");
  });

  it("nothing when the alert or the picker is cancelled", async () => {
    choose.mockResolvedValueOnce(null);
    await expect(pickFormPhoto()).resolves.toBeNull();
    expect(pick).not.toHaveBeenCalled();
    choose.mockResolvedValueOnce("library");
    pick.mockResolvedValueOnce({ status: "cancelled" });
    await expect(pickFormPhoto()).resolves.toBeNull();
  });

  it("explains a refused permission, for camera and library", async () => {
    const shown = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    pick.mockResolvedValue({ status: "denied" });
    choose.mockResolvedValueOnce("camera");
    await expect(pickFormPhoto()).resolves.toBeNull();
    expect(shown).toHaveBeenLastCalledWith(
      "Permission required",
      "We need camera access to take this photo.",
    );
    choose.mockResolvedValueOnce("library");
    await expect(pickFormPhoto()).resolves.toBeNull();
    expect(shown).toHaveBeenLastCalledWith(
      "Permission required",
      "We need photo-library access to choose this photo.",
    );
  });
});

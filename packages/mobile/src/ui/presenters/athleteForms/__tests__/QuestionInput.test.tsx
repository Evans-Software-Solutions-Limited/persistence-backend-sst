import { fireEvent } from "@testing-library/react-native";
import type { Question } from "@/domain/models/coachForms";
import type { AnswerValue } from "@/domain/models/athleteForms";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { QuestionInput } from "../QuestionInput";

function render(question: Question, value: AnswerValue) {
  const onChange = jest.fn();
  const onAddPhoto = jest.fn();
  const utils = renderWithTheme(
    <QuestionInput
      question={question}
      value={value}
      onChange={onChange}
      onAddPhoto={onAddPhoto}
    />,
  );
  return { onChange, onAddPhoto, ...utils };
}

const base = { id: "x", prompt: "Prompt", required: false };

describe("QuestionInput (C4f answers)", () => {
  it("short and long text", () => {
    const short = render({ ...base, type: "short_text" }, "hi");
    expect(short.getByTestId("question-text").props.value).toBe("hi");
    expect(short.getByTestId("question-text").props.multiline).toBe(false);
    fireEvent.changeText(short.getByTestId("question-text"), "hello");
    expect(short.onChange).toHaveBeenCalledWith("hello");
    short.unmount();

    const long = render({ ...base, type: "long_text" }, null);
    expect(long.getByTestId("question-text").props.value).toBe("");
    expect(long.getByTestId("question-text").props.multiline).toBe(true);
  });

  it("number with its unit", () => {
    const u = render({ ...base, type: "number", unit: "kg" }, "82");
    expect(u.getByText("kg")).toBeTruthy();
    fireEvent.changeText(u.getByTestId("question-number"), "83");
    expect(u.onChange).toHaveBeenCalledWith("83");
    u.unmount();
    const plain = render({ ...base, type: "number" }, 5);
    expect(plain.getByTestId("question-number").props.value).toBe("");
    expect(plain.queryByText("kg")).toBeNull();
  });

  it("scale 1–5", () => {
    const u = render({ ...base, type: "scale" }, 2);
    expect(
      u.getByTestId("question-scale-2").props.accessibilityState,
    ).toMatchObject({ selected: true });
    fireEvent.press(u.getByTestId("question-scale-5"));
    expect(u.onChange).toHaveBeenCalledWith(5);
  });

  it("single choice picks one, a second tap clears it", () => {
    const q: Question = {
      ...base,
      type: "single_choice",
      options: ["Good", "Bad"],
    };
    const picked = render(q, "Good");
    fireEvent.press(picked.getByTestId("question-choice-0"));
    expect(picked.onChange).toHaveBeenCalledWith(null);
    fireEvent.press(picked.getByTestId("question-choice-1"));
    expect(picked.onChange).toHaveBeenCalledWith("Bad");
    picked.unmount();
    const none = render(q, null);
    expect(
      none.getByTestId("question-choice-0").props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it("multiple choice toggles each option", () => {
    const q: Question = {
      ...base,
      type: "multiple_choice",
      options: ["Mon", "Tue"],
    };
    const u = render(q, ["Mon"]);
    fireEvent.press(u.getByTestId("question-choice-0"));
    expect(u.onChange).toHaveBeenLastCalledWith([]);
    fireEvent.press(u.getByTestId("question-choice-1"));
    expect(u.onChange).toHaveBeenLastCalledWith(["Mon", "Tue"]);
    u.unmount();
    const none = render(q, null);
    fireEvent.press(none.getByTestId("question-choice-1"));
    expect(none.onChange).toHaveBeenLastCalledWith(["Tue"]);
  });

  it("yes/no, with details when they say yes", () => {
    const q: Question = { ...base, type: "yes_no", detailsIfYes: true };
    const no = render(q, null);
    expect(no.queryByTestId("question-details")).toBeNull();
    fireEvent.press(no.getByTestId("question-yes"));
    expect(no.onChange).toHaveBeenCalledWith({ value: true, details: "" });
    fireEvent.press(no.getByTestId("question-no"));
    expect(no.onChange).toHaveBeenCalledWith({ value: false, details: "" });
    no.unmount();

    const yes = render(q, { value: true, details: "knee" });
    fireEvent.changeText(yes.getByTestId("question-details"), "left knee");
    expect(yes.onChange).toHaveBeenCalledWith({
      value: true,
      details: "left knee",
    });
  });

  it("photo: add, then show it with Retake", () => {
    const q: Question = { ...base, type: "photo" };
    const empty = render(q, null);
    fireEvent.press(empty.getByTestId("question-photo-add"));
    expect(empty.onAddPhoto).toHaveBeenCalled();
    empty.unmount();
    const taken = render(q, { uri: "file://a.jpg", mediaId: null });
    expect(taken.getByTestId("question-photo-image")).toBeTruthy();
    fireEvent.press(taken.getByTestId("question-photo-retake"));
    expect(taken.onAddPhoto).toHaveBeenCalled();
  });
});

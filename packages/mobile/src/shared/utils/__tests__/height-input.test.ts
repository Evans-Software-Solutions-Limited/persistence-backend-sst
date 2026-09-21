import { parseHeightInput, formatHeightInput } from "../height-input";
it.each([
  ["cm", "178", "", 178],
  ["in", "70", "", 177.8],
  ["mcm", "1", "78", 178],
  ["ftin", "5", "10", 177.8],
  ["mcm", "0", "90", 90],
  ["cm", "178,5", "", 178.5],
] as const)("parses %s", (format, value, inches, cm) =>
  expect(parseHeightInput({ value, inches }, format)).toBeCloseTo(cm, 8),
);
it.each([
  ["cm", "", ""],
  ["in", "bad", ""],
  ["cm", "-1", ""],
  ["cm", "Infinity", ""],
  ["mcm", "1.5", "0"],
  ["mcm", "1", "100"],
  ["mcm", "1", ""],
  ["ftin", "5", "12"],
  ["ftin", "5", "-1"],
  ["ftin", "5.5", "0"],
] as const)("rejects malformed %s %s/%s", (format, value, inches) =>
  expect(parseHeightInput({ value, inches }, format)).toBeNull(),
);
it.each(["cm", "mcm", "in", "ftin"] as const)("formats %s", (format) => {
  expect(formatHeightInput(null, format)).toEqual({ value: "", inches: "" });
  expect(
    parseHeightInput(formatHeightInput(177.8, format), format),
  ).toBeCloseTo(177.8, 3);
});
it("carries rounded remainders into the major field", () => {
  expect(formatHeightInput(199.999999, "mcm")).toEqual({
    value: "2",
    inches: "0",
  });
  expect(formatHeightInput(182.879999, "ftin")).toEqual({
    value: "6",
    inches: "0",
  });
});

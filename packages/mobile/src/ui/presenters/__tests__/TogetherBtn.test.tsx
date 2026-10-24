import React from "react";
import { StyleSheet } from "react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherBtn } from "../TogetherBtn";

const flatOf = (node: { props: { style?: unknown } } | null) =>
  ((node && StyleSheet.flatten(node.props.style as never)) ?? {}) as Record<
    string,
    number
  >;

it.each([
  ["lg", 52, 14, 15],
  ["md", 44, 14, 15],
  ["sm", 44, 10, 13],
] as const)(
  "%s is the canvas .btn at %dpt, radius %d, label %dpt",
  (size, height, radius, fontSize) => {
    const r = renderWithTheme(
      <TogetherBtn size={size} onPress={() => undefined} testID="btn">
        Go
      </TogetherBtn>,
    );
    expect(flatOf(r.getByText("Go")).fontSize).toBe(fontSize);
    // The sized box is the nearest ancestor of the label that carries a height.
    let node = r.getByText("Go").parent;
    while (node && flatOf(node as never).height === undefined) {
      node = node.parent;
    }
    const box = flatOf(node as never);
    expect(box.height).toBe(height);
    expect(box.borderTopLeftRadius).toBe(radius);
  },
);

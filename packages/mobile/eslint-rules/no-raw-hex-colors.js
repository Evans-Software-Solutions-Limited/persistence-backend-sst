// Custom ESLint rule: no-raw-hex-colors
//
// Implements 01-design-system/requirements.md STORY-006 AC 6.4 + the
// design.md 2026-05-29 codemod-scope revision. Flags raw hex colour string
// literals **in token-resolvable positions** so future screen work can't
// reintroduce magic colour values where a Tamagui token belongs.
//
// It deliberately mirrors the codemod's skip logic — hex that feeds a
// concrete-colour consumer (SVG fill/stroke, LinearGradient colours, lucide /
// Ionicons / ActivityIndicator `color`, RN StyleSheet bodies, fg/bg tone-map
// entries, `*Color` variables) is NOT a token-resolvable position and is
// allowed, because Tamagui tokens don't resolve there. This keeps the design
// system's necessary RN/SVG bridge code legal while still blocking a stray
// `<View backgroundColor="#22d3ee">` that should use `$primary`.
//
// File scope (theme/** + __tests__/** exclusions) is applied in
// eslint.config.js.

const HEX_COLOR = /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

const SKIP_JSX_ATTRS = new Set([
  "fill",
  "stroke",
  "color",
  "colors",
  "tintColor",
  "placeholderTextColor",
  "shadowColor",
  "borderTopColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRightColor",
]);

// Object-property keys that hold a concrete colour for a non-Tamagui consumer
// (RN inline styles use the SKIP_JSX_ATTRS names as keys; tone-maps use
// fg/bg/ink/base/dim/glow/bright/depth). This set is kept in lockstep with the
// codemod's CONCRETE_COLOUR_KEYS so the lint rule and codemod describe the same
// world (PR #83 review): a hex in any of these positions is a concrete colour,
// not a tokenisable Tamagui style prop.
const TONE_MAP_KEYS = [
  "fg",
  "bg",
  "ink",
  "base",
  "dim",
  "glow",
  "bright",
  "depth",
];
const CONCRETE_COLOUR_KEYS = new Set([...SKIP_JSX_ATTRS, ...TONE_MAP_KEYS]);

function isSkippedJsxAttrName(name) {
  // Only the explicit set above is exempt. Generic Tamagui style props like
  // `backgroundColor` / `borderColor` are NOT exempt — those are exactly where
  // a token belongs, so the rule must flag raw hex there.
  return SKIP_JSX_ATTRS.has(name);
}

/** Walk ancestors to decide whether this literal is in a skipped position. */
function inSkippedPosition(node, ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    const child = i + 1 < ancestors.length ? ancestors[i + 1] : node;

    // JSXAttribute value (color="#fff", colors={[...]}, fill=..., *Color=...)
    if (
      a.type === "JSXAttribute" &&
      a.name &&
      a.name.type === "JSXIdentifier"
    ) {
      if (isSkippedJsxAttrName(a.name.name)) return true;
    }

    // StyleSheet.create({ ... }) body
    if (
      a.type === "CallExpression" &&
      a.callee &&
      a.callee.type === "MemberExpression" &&
      a.callee.object &&
      a.callee.object.type === "Identifier" &&
      a.callee.object.name === "StyleSheet" &&
      a.callee.property &&
      a.callee.property.type === "Identifier" &&
      a.callee.property.name === "create"
    ) {
      return true;
    }

    // return "#..." — ONLY when the literal is *directly* the returned value,
    // or wrapped in a Conditional/Logical/Sequence expression that still flows
    // it straight out. A JSX subtree between the literal and the return must
    // NOT exempt the literal — that's the standard React render shape and would
    // silently allow raw hex in `backgroundColor` / `borderColor` (PR #83
    // Lead 9). Mirrors the codemod's collectStraightReturnLiterals narrowing.
    if (a.type === "ReturnStatement" && a.argument === child) {
      const wrapsLiteral = (n) =>
        n === node ||
        (n &&
          n.type === "ConditionalExpression" &&
          (wrapsLiteral(n.consequent) || wrapsLiteral(n.alternate))) ||
        (n &&
          n.type === "LogicalExpression" &&
          (wrapsLiteral(n.left) || wrapsLiteral(n.right))) ||
        (n &&
          n.type === "SequenceExpression" &&
          n.expressions.some(wrapsLiteral));
      if (wrapsLiteral(child)) return true;
    }

    // { fg: "#...", bg: "#...", shadowColor: "#...", color: "#...", ... } —
    // object-property colour keys consumed by RN styles / concrete consumers.
    if (
      (a.type === "Property" || a.type === "ObjectProperty") &&
      a.value === child &&
      a.key
    ) {
      const keyName =
        a.key.type === "Identifier"
          ? a.key.name
          : a.key.type === "Literal"
            ? a.key.value
            : null;
      if (typeof keyName === "string" && CONCRETE_COLOUR_KEYS.has(keyName)) {
        return true;
      }
    }

    // const xxxColor = "#..."
    if (
      a.type === "VariableDeclarator" &&
      a.init === child &&
      a.id &&
      a.id.type === "Identifier" &&
      /color$/i.test(a.id.name)
    ) {
      return true;
    }
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw hex colour literals in token-resolvable positions; use Tamagui design tokens instead.",
    },
    schema: [],
    messages: {
      rawHex:
        'Raw hex colour "{{value}}" is not allowed here. Use a Tamagui token (e.g. $primary, $text, $bg) from @/ui/theme/tokens. (Concrete-colour consumers like SVG/gradient/icon props are exempt — this position resolves the theme.)',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    function check(node, raw) {
      if (typeof raw !== "string" || !HEX_COLOR.test(raw.trim())) return;
      const ancestors = sourceCode.getAncestors
        ? sourceCode.getAncestors(node)
        : context.getAncestors();
      if (inSkippedPosition(node, ancestors)) return;
      context.report({ node, messageId: "rawHex", data: { value: raw } });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          check(node, node.quasis[0].value.cooked);
        }
      },
    };
  },
};

module.exports = {
  rules: {
    "no-raw-hex-colors": rule,
  },
};

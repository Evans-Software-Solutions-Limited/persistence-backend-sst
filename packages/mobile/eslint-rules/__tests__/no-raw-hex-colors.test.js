const { RuleTester } = require("eslint");

const plugin = require("../no-raw-hex-colors");
const rule = plugin.rules["no-raw-hex-colors"];

// espree (eslint's bundled default parser) handles plain JSX with the jsx
// ecmaFeature — no TS types are used in these fixtures, so no extra parser
// dependency is needed.
const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-raw-hex-colors", rule, {
  valid: [
    // token references, not hex
    `const s = { backgroundColor: "$primary" };`,
    // concrete-colour consumers are exempt
    `const C = () => <Path fill="#00D4FF" stroke="#FFFFFF" />;`,
    `const C = () => <Ionicons color="#fff" />;`,
    `const G = () => <LinearGradient colors={["#22D3EE", "#0E7490"]} />;`,
    `const s = StyleSheet.create({ t: { color: "#fff" } });`,
    `function ink() { return "#0A0B12"; }`,
    `const tones = { a: { fg: "#00D4FF", bg: "#0A0B12" } };`,
    // tone-map + RN-style concrete-colour object keys are skipped (lockstep
    // with the codemod's CONCRETE_COLOUR_KEYS — PR #83 Lead 7)
    `const t = { ink: "#0A0B12", base: "#22D3EE" };`,
    `const s = { shadowColor: "#FFFFFF", tintColor: "#00D4FF" };`,
    `const textColor = "#FFFFFF";`,
    `const x = { shadowColor: "#000000" };`,
    // non-colour strings
    `const id = "#section-anchor";`,
  ],
  invalid: [
    {
      code: `const C = () => <View backgroundColor="#22D3EE" />;`,
      errors: [{ messageId: "rawHex" }],
    },
    {
      code: `const C = () => <View borderColor="#1A1D29" />;`,
      errors: [{ messageId: "rawHex" }],
    },
    {
      code: `const s = { tint: "#00D4FF" };`,
      errors: [{ messageId: "rawHex" }],
    },
  ],
});

// RuleTester throws on failure; reaching here means all cases passed. We wrap
// in a vitest-less assertion so `bun test`/node can run it directly too.
// eslint-disable-next-line no-console
console.log("no-raw-hex-colors RuleTester: all cases passed");

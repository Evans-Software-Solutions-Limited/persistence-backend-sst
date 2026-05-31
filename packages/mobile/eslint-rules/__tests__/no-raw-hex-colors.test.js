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
    `function pick(x) { return x ? "#0A0B12" : "#00D4FF"; }`,
    // arrow concise-body colour resolver — twin of `return "#..."`, skipped
    // the same way (PR #83 Lead C)
    `const ink = () => "#0A0B12";`,
    `const pick = (x) => (x ? "#0A0B12" : "#00D4FF");`,
    `const tones = { a: { fg: "#00D4FF", bg: "#0A0B12" } };`,
    // tone-map + RN-style concrete-colour object keys are skipped (lockstep
    // with the codemod's CONCRETE_COLOUR_KEYS — PR #83 Lead 7)
    `const t = { ink: "#0A0B12", base: "#22D3EE" };`,
    `const s = { shadowColor: "#FFFFFF", tintColor: "#00D4FF" };`,
    `const textColor = "#FFFFFF";`,
    `const x = { shadowColor: "#000000" };`,
    // backgroundColor / borderColor as object KEYS (RN style objects, not
    // Tamagui props) are concrete-colour positions → skipped (PR #83 Lead A)
    `const C = () => <View style={{ backgroundColor: "#00D4FF", borderColor: "#0A0B12" }} />;`,
    `const styles = { card: { backgroundColor: "#00D4FF" } };`,
    // *Color-suffixed object keys (lightColor / activeColor) → skipped, same as
    // *Color variables (PR #83 Lead D)
    `const ch = { lightColor: "#00D4FF" };`,
    `const s2 = { activeColor: "#0A0B12" };`,
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
    // Block-body return (standard React render shape) MUST still be flagged —
    // the return-skip narrowing only exempts a literal returned straight out,
    // not hex in a returned JSX subtree (PR #83 Lead 9).
    {
      code: `function C() { return <View backgroundColor="#22D3EE" />; }`,
      errors: [{ messageId: "rawHex" }],
    },
    {
      code: `function C() { return (<View><Inner borderColor="#1A1D29" /></View>); }`,
      errors: [{ messageId: "rawHex" }],
    },
    // Arrow returning JSX is the render shape, NOT a colour resolver — the
    // concise-body skip must not over-exempt it (PR #83 Lead C).
    {
      code: `const Card = () => <View backgroundColor="#0E7490" />;`,
      errors: [{ messageId: "rawHex" }],
    },
    // backgroundColor as a JSX ATTRIBUTE still resolves a token → flagged, even
    // though the object-KEY form is skipped (PR #83 Lead A).
    {
      code: `const C = () => <View backgroundColor="#0A0B12" borderColor="#22D3EE" />;`,
      errors: [{ messageId: "rawHex" }, { messageId: "rawHex" }],
    },
  ],
});

// RuleTester throws on failure; reaching here means all cases passed. We wrap
// in a vitest-less assertion so `bun test`/node can run it directly too.
// eslint-disable-next-line no-console
console.log("no-raw-hex-colors RuleTester: all cases passed");

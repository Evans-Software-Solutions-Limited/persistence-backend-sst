import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isExcluded,
  parseCodemodArgs,
  parseLegacyPrimaryRgba,
  resolveToken,
  runCodemod,
  transformSource,
} from "../codemod-tokens";

describe("resolveToken — replacement table (STORY-006 AC 6.2)", () => {
  it("maps the legacy brand cyan to $primary", () => {
    expect(resolveToken("#00D4FF")).toBe("$primary");
    expect(resolveToken("#00d4ff")).toBe("$primary"); // case-insensitive
  });

  it("maps white hex forms to $text (bare 'white' word is NOT replaced)", () => {
    expect(resolveToken("#FFFFFF")).toBe("$text");
    expect(resolveToken("#FFF")).toBe("$text");
    // bare word-colour intentionally not handled — too risky position-agnostic
    expect(resolveToken("white")).toBeNull();
  });

  it("maps gold forms to $gold", () => {
    expect(resolveToken("#FFD700")).toBe("$gold");
    expect(resolveToken("#FFC700")).toBe("$gold");
  });

  it("maps background forms to $bg", () => {
    expect(resolveToken("#0A0A0F")).toBe("$bg");
    expect(resolveToken("#0A0B12")).toBe("$bg");
    expect(resolveToken("#0B0B12")).toBe("$bg");
  });

  it("maps low-alpha legacy-primary rgba to $primaryDim", () => {
    expect(resolveToken("rgba(0,212,255,0.10)")).toBe("$primaryDim");
    expect(resolveToken("rgba(0, 212, 255, 0.2)")).toBe("$primaryDim");
  });

  it("maps high-alpha legacy-primary rgba to $primaryGlow", () => {
    expect(resolveToken("rgba(0,212,255,0.22)")).toBe("$primaryGlow");
    expect(resolveToken("rgba(0,212,255,0.5)")).toBe("$primaryGlow");
  });

  it("returns null for unrecognised colours", () => {
    expect(resolveToken("#123456")).toBeNull();
    expect(resolveToken("rgba(1,2,3,0.5)")).toBeNull();
    expect(resolveToken("not a colour")).toBeNull();
    expect(resolveToken("$primary")).toBeNull(); // already a token (idempotent)
  });
});

describe("parseLegacyPrimaryRgba", () => {
  it("parses alpha from rgba", () => {
    expect(parseLegacyPrimaryRgba("rgba(0,212,255,0.15)")).toEqual({
      alpha: 0.15,
    });
  });

  it("treats rgb (no alpha) as fully opaque", () => {
    expect(parseLegacyPrimaryRgba("rgb(0,212,255)")).toEqual({ alpha: 1 });
  });

  it("rejects non-primary triples", () => {
    expect(parseLegacyPrimaryRgba("rgba(10,20,30,0.5)")).toBeNull();
  });
});

describe("transformSource — AST behaviour + edge cases", () => {
  it("replaces a hex string literal in a tokenisable style object key", () => {
    // `tint` is not a concrete-colour-consumer key, so it's a tokenisable
    // position (unlike `color`/`shadowColor`/`fg`, which are skipped).
    const src = `const s = { tint: "#00D4FF" };`;
    const { output, replacements } = transformSource(src);
    expect(replacements).toBe(1);
    expect(output).toContain('"$primary"');
    expect(output).not.toContain("#00D4FF");
  });

  it("leaves hex inside comments alone", () => {
    const src = `// brand is #00D4FF\nconst s = { tint: "#123456" };`;
    const { output, replacements } = transformSource(src);
    expect(replacements).toBe(0);
    expect(output).toContain("#00D4FF"); // comment untouched
  });

  it("leaves hex in SVG fill / stroke JSX attributes alone", () => {
    const src = `const Icon = () => <Path fill="#00D4FF" stroke="#FFFFFF" />;`;
    const { replacements } = transformSource(src);
    expect(replacements).toBe(0);
  });

  it("leaves hex in concrete-colour-consumer props alone (fill/stroke/color/colors/shadowColor)", () => {
    const src = `const C = () => <View color="#00D4FF" shadowColor="#FFFFFF" />;`;
    expect(transformSource(src).replacements).toBe(0);
    const grad = `const G = () => <LinearGradient colors={["rgba(0,212,255,0.08)", "#00D4FF"]} />;`;
    expect(transformSource(grad).replacements).toBe(0);
    const icon = `const I = () => <Ionicons color="#fff" />;`;
    expect(transformSource(icon).replacements).toBe(0);
  });

  it("DOES rewrite Tamagui style props backgroundColor / borderColor (matches the lint rule — PR #83 fix)", () => {
    const bg = `const C = () => <View backgroundColor="#00D4FF" />;`;
    expect(transformSource(bg).replacements).toBe(1);
    expect(transformSource(bg).output).toContain('"$primary"');
    const border = `const C = () => <View borderColor="#0A0B12" />;`;
    expect(transformSource(border).replacements).toBe(1);
    expect(transformSource(border).output).toContain('"$bg"');
  });

  it("leaves hex inside StyleSheet.create bodies alone (RN styles)", () => {
    const src = `const s = StyleSheet.create({ time: { color: "#FFFFFF" }, bar: { backgroundColor: "#00D4FF" } });`;
    expect(transformSource(src).replacements).toBe(0);
  });

  it("still replaces a plain style-object hex (token-resolvable position)", () => {
    const src = `const tone = { tint: "#00D4FF" };`;
    const { output, replacements } = transformSource(src);
    expect(replacements).toBe(1);
    expect(output).toContain('"$primary"');
  });

  it("skips return-statement hex (flows to a concrete-colour consumer)", () => {
    const src = `function ink() { return "#0A0B12"; }`;
    expect(transformSource(src).replacements).toBe(0);
  });

  it("skips a direct return wrapped in a conditional (still flows straight out)", () => {
    const src = `function ink(x) { return x ? "#0A0B12" : "#00D4FF"; }`;
    expect(transformSource(src).replacements).toBe(0);
  });

  it("STILL rewrites hex in a block-body return's JSX (not the standard render shape exemption — PR #83 Lead 10)", () => {
    const src = `function Card() { return <View backgroundColor="#00D4FF" borderColor="#0A0B12" />; }`;
    const { replacements, output } = transformSource(src);
    expect(replacements).toBe(2);
    expect(output).toContain('"$primary"');
    expect(output).toContain('"$bg"');
  });

  it("skips an arrow concise-body colour resolver (twin of return '#...' — PR #83 Lead C)", () => {
    expect(transformSource(`const ink = () => "#00D4FF";`).replacements).toBe(
      0,
    );
    // wrapped in a conditional that still flows straight out → skipped
    expect(
      transformSource(`const ink = (x) => (x ? "#0A0B12" : "#00D4FF");`)
        .replacements,
    ).toBe(0);
  });

  it("STILL rewrites hex in an arrow returning JSX (render shape, not a resolver — PR #83 Lead C)", () => {
    const src = `const C = () => <View backgroundColor="#00D4FF" />;`;
    expect(transformSource(src).replacements).toBe(1);
    expect(transformSource(src).output).toContain('"$primary"');
  });

  it("skips backgroundColor / borderColor as object KEYS (RN style objects, not Tamagui props — PR #83 Lead A)", () => {
    // `style={{ backgroundColor: "#..." }}` is a plain RN style object — RN
    // can't resolve a Tamagui token there. The JSX-attribute form is still
    // rewritten (asserted above); only the object-key form is skipped.
    const inline = `const C = () => <View style={{ backgroundColor: "#00D4FF", borderColor: "#0A0B12" }} />;`;
    expect(transformSource(inline).replacements).toBe(0);
    const constObj = `const styles = { card: { backgroundColor: "#00D4FF" } };`;
    expect(transformSource(constObj).replacements).toBe(0);
  });

  it("skips *Color-suffixed object keys (lightColor / activeColor — concrete-colour consumers, PR #83 Lead D)", () => {
    expect(
      transformSource(`const ch = { lightColor: "#00D4FF" };`).replacements,
    ).toBe(0);
    expect(
      transformSource(`const s = { activeColor: "#0A0B12" };`).replacements,
    ).toBe(0);
  });

  it("skips fg / bg / ink tone-map property hex (consumed as icon/indicator colour)", () => {
    const src = `const tones = { expert: { fg: "#00D4FF", bg: "rgba(0,212,255,0.12)", ink: "#0A0B12" } };`;
    expect(transformSource(src).replacements).toBe(0);
  });

  it("skips concrete-consumer object keys (shadowColor) — matches the lint rule (PR #83 Lead 7)", () => {
    // RN inline style: `style={{ shadowColor: "#FFFFFF" }}` is a concrete-colour
    // position the lint rule also skips. The codemod must not rewrite it to a
    // Tamagui token that RN can't resolve.
    const src = `const s = { shadowColor: "#FFFFFF", tintColor: "#00D4FF" };`;
    expect(transformSource(src).replacements).toBe(0);
  });

  it("skips *Color variable declarators (flow to a color prop)", () => {
    const src = `const textColor = "#FFFFFF";`;
    expect(transformSource(src).replacements).toBe(0);
  });

  it("replaces multiple literals and counts them", () => {
    const src = `const s = { a: "#00D4FF", b: "#FFD700", c: "#0A0B12" };`;
    const { replacements } = transformSource(src);
    expect(replacements).toBe(3);
  });

  it("is idempotent — a second pass makes no further change", () => {
    const src = `const s = { color: "#00D4FF" };`;
    const first = transformSource(src);
    const second = transformSource(first.output);
    expect(second.replacements).toBe(0);
    expect(second.output).toBe(first.output);
  });

  it("returns the source unchanged when there is nothing to replace", () => {
    const src = `const s = { color: "$primary" };`;
    const { output, replacements } = transformSource(src);
    expect(replacements).toBe(0);
    expect(output).toBe(src);
  });
});

describe("isExcluded", () => {
  it("excludes the theme directory", () => {
    expect(isExcluded("packages/mobile/src/ui/theme/tokens.ts")).toBe(true);
  });

  it("excludes the whole __tests__ tree (not just fixtures)", () => {
    expect(
      isExcluded("packages/mobile/src/ui/__tests__/fixtures/sample.ts"),
    ).toBe(true);
    expect(
      isExcluded("packages/mobile/src/ui/components/__tests__/Card.test.tsx"),
    ).toBe(true);
  });

  it("does not exclude a regular component file", () => {
    expect(isExcluded("packages/mobile/src/ui/components/Card.tsx")).toBe(
      false,
    );
  });

  it("excludes the foundation + composite primitive dirs (RN/SVG colour bridge — lockstep with lint, PR #83 Lead B)", () => {
    expect(
      isExcluded("packages/mobile/src/ui/components/foundation/Bar.tsx"),
    ).toBe(true);
    expect(
      isExcluded("packages/mobile/src/ui/components/composite/HabitTile.tsx"),
    ).toBe(true);
  });

  it("excludes the lint-allow-listed legacy-screen files (PR #83 Lead B)", () => {
    expect(
      isExcluded("packages/mobile/src/ui/components/home/WorkoutCard.tsx"),
    ).toBe(true);
    expect(
      isExcluded(
        "packages/mobile/src/ui/components/subscription/SubscriptionBadge.tsx",
      ),
    ).toBe(true);
    expect(
      isExcluded(
        "packages/mobile/src/ui/components/workouts/WorkoutCard/styles.ts",
      ),
    ).toBe(true);
    // a different file in the same `home` dir is NOT blanket-excluded
    expect(
      isExcluded("packages/mobile/src/ui/components/home/SimpleLineGraph.tsx"),
    ).toBe(false);
  });
});

describe("parseCodemodArgs", () => {
  it("defaults to dry-run on packages/mobile/src", () => {
    expect(parseCodemodArgs([])).toEqual({
      apply: false,
      dir: "packages/mobile/src",
    });
  });

  it("enables apply with --apply", () => {
    expect(parseCodemodArgs(["--apply"]).apply).toBe(true);
  });

  it("accepts --dir and --dir=", () => {
    expect(parseCodemodArgs(["--dir", "a/b"]).dir).toBe("a/b");
    expect(parseCodemodArgs(["--dir=c/d"]).dir).toBe("c/d");
  });
});

describe("runCodemod — directory walk (STORY-006 AC 6.5)", () => {
  function makeTree(): string {
    const root = mkdtempSync(path.join(tmpdir(), "codemod-"));
    mkdirSync(path.join(root, "ui", "components"), { recursive: true });
    mkdirSync(path.join(root, "ui", "theme"), { recursive: true });
    mkdirSync(path.join(root, "ui", "__tests__"), { recursive: true });
    // tokenisable hex in a plain style object
    writeFileSync(
      path.join(root, "ui", "components", "A.tsx"),
      `const s = { tint: "#00D4FF" };\n`,
    );
    // excluded: theme dir
    writeFileSync(
      path.join(root, "ui", "theme", "tokens.ts"),
      `const t = { c: "#00D4FF" };\n`,
    );
    // excluded: __tests__ dir
    writeFileSync(
      path.join(root, "ui", "__tests__", "A.test.tsx"),
      `const t = "#00D4FF";\n`,
    );
    // .d.ts is skipped
    writeFileSync(path.join(root, "ui", "x.d.ts"), `export type X = string;\n`);
    return root;
  }

  it("dry-run reports changes without writing", () => {
    const root = makeTree();
    try {
      const report = runCodemod(root, false);
      expect(report.filesChanged).toBe(1);
      expect(report.totalReplacements).toBe(1);
      // file content unchanged in dry-run
      const content = readFileSync(
        path.join(root, "ui", "components", "A.tsx"),
        "utf8",
      );
      expect(content).toContain("#00D4FF");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("apply writes the tokenised output and skips theme + __tests__", () => {
    const root = makeTree();
    try {
      const report = runCodemod(root, true);
      expect(report.filesChanged).toBe(1);
      const applied = readFileSync(
        path.join(root, "ui", "components", "A.tsx"),
        "utf8",
      );
      expect(applied).toContain("$primary");
      expect(applied).not.toContain("#00D4FF");
      // excluded files untouched
      expect(
        readFileSync(path.join(root, "ui", "theme", "tokens.ts"), "utf8"),
      ).toContain("#00D4FF");
      expect(
        readFileSync(path.join(root, "ui", "__tests__", "A.test.tsx"), "utf8"),
      ).toContain("#00D4FF");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent across a second apply pass", () => {
    const root = makeTree();
    try {
      runCodemod(root, true);
      const second = runCodemod(root, true);
      expect(second.totalReplacements).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

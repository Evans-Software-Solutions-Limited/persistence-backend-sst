#!/usr/bin/env bun
/**
 * codemod-tokens — retire hard-coded colour strings in the mobile UI to
 * Tamagui token references.
 *
 * Implements 01-design-system/requirements.md STORY-006 (AC 6.1, 6.2, 6.5) +
 * design.md § Codemod. AST transform (jscodeshift) so it correctly skips:
 *   - hex inside comments (comments aren't string literals)
 *   - hex inside SVG `fill` / `stroke` JSX attributes (icon migration owns those)
 *   - the `theme/**` + `__tests__/fixtures/**` paths (excluded at the file walk)
 *
 * Idempotent: token strings ($primary, …) don't match the hex/rgba patterns,
 * so a second pass is a no-op. Dry-run by default; `--apply` writes.
 *
 * Usage
 * ─────
 *   bun run scripts/codemod-tokens.ts --dry  > codemod-report.txt   # default
 *   bun run scripts/codemod-tokens.ts --apply
 *   bun run scripts/codemod-tokens.ts --apply --dir packages/mobile/src/ui
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import jscodeshift from "jscodeshift";

// ─── Replacement table (design.md § Codemod) ──────────────────────────

/** Exact case-insensitive string → token replacements.
 *
 * The bare word-colour `"white"` is intentionally NOT included: `resolveToken`
 * is position-agnostic, so a `"white"` arm would rewrite any string literal
 * `"white"` the walk doesn't explicitly skip (accessibilityLabel, placeholder,
 * a plain `const tag = "white"`, …) into `"$text"`, which RN can't parse
 * (PR #83 review fix). Hex forms (`#FFFFFF`/`#FFF`) are unambiguous colours and
 * cover the real cases; word-colours must be hex'd by hand first. */
export const HEX_REPLACEMENTS: { match: string[]; token: string }[] = [
  { match: ["#00D4FF"], token: "$primary" },
  { match: ["#FFFFFF", "#FFF"], token: "$text" },
  { match: ["#FFD700", "#FFC700"], token: "$gold" },
  { match: ["#0A0A0F", "#0A0B12", "#0B0B12"], token: "$bg" },
];

/** Legacy primary as an rgb triple — used to recognise rgba() variants. */
const PRIMARY_RGB = { r: 0, g: 212, b: 255 };
/** Alpha at or below this maps to $primaryDim; above to $primaryGlow. */
const DIM_ALPHA_CEILING = 0.2;

/** JSX attribute names whose hex values are concrete colours for a non-Tamagui
 * consumer (SVG, LinearGradient, Ionicons/ActivityIndicator, RN style props
 * that don't resolve Tamagui tokens). This set deliberately mirrors the
 * `no-raw-hex-colors` ESLint rule so the codemod and the lint rule describe
 * the same world: generic Tamagui style props (`backgroundColor`,
 * `borderColor`) are NOT skipped — those are exactly where a token belongs,
 * and the lint rule flags raw hex there (PR #83 review fix). */
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

function isSkippedJsxAttr(name: string): boolean {
  return SKIP_JSX_ATTRS.has(name);
}

/**
 * Resolve a raw string value to its replacement token, or null when it
 * isn't a recognised colour string. Case-insensitive for hex.
 */
export function resolveToken(raw: string): string | null {
  const trimmed = raw.trim();

  for (const { match, token } of HEX_REPLACEMENTS) {
    if (match.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
      return token;
    }
  }

  const rgba = parseLegacyPrimaryRgba(trimmed);
  if (rgba !== null) {
    return rgba.alpha <= DIM_ALPHA_CEILING ? "$primaryDim" : "$primaryGlow";
  }

  return null;
}

/**
 * Parse `rgba(0,212,255,A)` (any whitespace) into its alpha when the RGB
 * triple matches the legacy primary; null otherwise. `rgb(...)` with no
 * alpha is treated as fully opaque (alpha 1 → Glow).
 */
export function parseLegacyPrimaryRgba(
  value: string,
): { alpha: number } | null {
  const m = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)$/i,
  );
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (r !== PRIMARY_RGB.r || g !== PRIMARY_RGB.g || b !== PRIMARY_RGB.b) {
    return null;
  }
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return { alpha };
}

/**
 * Add every StringLiteral that is the value *flowing straight out* of a return
 * argument to `skip` — directly, or only through expression wrappers that pass
 * the value through unchanged (conditional / logical / sequence / parenthesised
 * / TS `as` casts). Crucially it does NOT descend into JSX, calls, objects, or
 * arrays — so `return <View backgroundColor="#hex" />` is left rewritable
 * (PR #83 Lead 10). Mirrors the lint rule's return-skip narrowing.
 */
function collectStraightReturnLiterals(
  node: unknown,
  skip: Set<unknown>,
): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type: string; [k: string]: unknown };
  switch (n.type) {
    case "StringLiteral":
      skip.add(n);
      return;
    case "ConditionalExpression":
      collectStraightReturnLiterals(n.consequent, skip);
      collectStraightReturnLiterals(n.alternate, skip);
      return;
    case "LogicalExpression":
      collectStraightReturnLiterals(n.left, skip);
      collectStraightReturnLiterals(n.right, skip);
      return;
    case "SequenceExpression":
      for (const e of (n.expressions as unknown[]) ?? []) {
        collectStraightReturnLiterals(e, skip);
      }
      return;
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
      collectStraightReturnLiterals(n.expression, skip);
      return;
    default:
      // Any other wrapper (JSX, CallExpression, ObjectExpression, …) does NOT
      // flow the literal straight out — leave it rewritable.
      return;
  }
}

// ─── AST transform ────────────────────────────────────────────────────

export type TransformResult = {
  output: string;
  /** Per-token replacement counts. */
  replacements: number;
  /** Detail lines for the report. */
  details: { from: string; to: string }[];
};

/**
 * Transform a single source file's contents. Pure — returns the new source
 * and a replacement count. Skips `fill`/`stroke` JSX attribute values.
 */
export function transformSource(source: string): TransformResult {
  const j = jscodeshift.withParser("tsx");
  const root = j(source);
  const details: { from: string; to: string }[] = [];

  // Set of StringLiteral nodes that must NOT be rewritten:
  //  - the value of a skipped JSX attribute (concrete colour for a non-Tamagui
  //    consumer), or
  //  - any string literal inside a StyleSheet.create(...) call (RN StyleSheet
  //    doesn't resolve Tamagui tokens).
  const skipNodes = new Set<unknown>();

  root.find(j.JSXAttribute).forEach((p) => {
    const nameNode = p.node.name;
    const attrName =
      nameNode && nameNode.type === "JSXIdentifier" ? nameNode.name : null;
    if (attrName && isSkippedJsxAttr(attrName) && p.node.value) {
      // Mark every string literal within the attribute value subtree (covers
      // `color="#fff"` and `colors={["#fff", ...]}`).
      j(p.get("value"))
        .find(j.StringLiteral)
        .forEach((s) => skipNodes.add(s.node));
      // The attribute value may itself be a StringLiteral node.
      skipNodes.add(p.node.value);
    }
  });

  // StyleSheet.create({ ... }) bodies.
  root
    .find(j.CallExpression, {
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "StyleSheet" },
        property: { type: "Identifier", name: "create" },
      },
    })
    .forEach((p) => {
      j(p)
        .find(j.StringLiteral)
        .forEach((s) => skipNodes.add(s.node));
    });

  // Conservative guards for values that flow into concrete-colour consumers
  // (lucide / Ionicons `color`, ActivityIndicator `color`, gradient colour
  // maps) via a variable or function rather than a direct Tamagui style prop.
  // The AST can't trace that flow, so we skip the structural shapes that, in
  // this codebase, always feed a concrete-colour consumer:
  //   - `return "#..."` (e.g. resolveInk(tone) -> icon color) — ONLY when the
  //     literal is *directly* the returned value (or wrapped in a
  //     conditional/logical/sequence/paren that still flows it straight out).
  //     A JSX subtree between the `return` and the literal must NOT exempt it —
  //     that's the standard React render shape and would silently skip raw hex
  //     in `backgroundColor` / `borderColor` (PR #83 Lead 10).
  //   - object properties keyed by a concrete-colour key (see below).
  root.find(j.ReturnStatement).forEach((p) => {
    const arg = p.node.argument;
    if (!arg) return;
    collectStraightReturnLiterals(arg, skipNodes);
  });
  // Object-property colour keys that hold concrete colours for non-Tamagui
  // consumers. Kept in lockstep with the `no-raw-hex-colors` ESLint rule's
  // CONCRETE_COLOUR_KEYS so the codemod and lint rule describe the same world
  // (PR #83 review): the SKIP_JSX_ATTRS names (RN inline styles use them as
  // keys — e.g. `style={{ shadowColor: "#fff" }}`) PLUS the tone-map keys
  // (fg/bg/ink/base/dim/glow/bright/depth, e.g. the TONE_HEX bridge map).
  const CONCRETE_COLOUR_KEYS = new Set([
    ...SKIP_JSX_ATTRS,
    "fg",
    "bg",
    "ink",
    "base",
    "dim",
    "glow",
    "bright",
    "depth",
  ]);
  root.find(j.ObjectProperty).forEach((p) => {
    const key = p.node.key;
    const keyName =
      key.type === "Identifier"
        ? key.name
        : key.type === "StringLiteral"
          ? key.value
          : null;
    if (typeof keyName === "string" && CONCRETE_COLOUR_KEYS.has(keyName)) {
      const value = p.node.value;
      if (value.type === "StringLiteral") skipNodes.add(value);
      j(p.get("value"))
        .find(j.StringLiteral)
        .forEach((s) => skipNodes.add(s.node));
    }
  });

  // Variable declarators whose name signals a concrete-colour consumer
  // (e.g. `const textColor = "#FFFFFF"` -> <ActivityIndicator color=...>).
  root.find(j.VariableDeclarator).forEach((p) => {
    const id = p.node.id;
    const name = id.type === "Identifier" ? id.name : null;
    if (name && /color$/i.test(name) && p.node.init) {
      const init = p.node.init;
      if (init.type === "StringLiteral") skipNodes.add(init);
      j(p.get("init"))
        .find(j.StringLiteral)
        .forEach((s) => skipNodes.add(s.node));
    }
  });

  root.find(j.StringLiteral).forEach((p) => {
    if (skipNodes.has(p.node)) return;
    const current = p.node.value;
    const token = resolveToken(current);
    if (token !== null && token !== current) {
      details.push({ from: current, to: token });
      p.node.value = token;
    }
  });

  if (details.length === 0) {
    return { output: source, replacements: 0, details };
  }

  // quote: "double" keeps the project's prettier style; recast preserves the
  // rest of the formatting verbatim.
  return {
    output: root.toSource({ quote: "double" }),
    replacements: details.length,
    details,
  };
}

// ─── File walk ────────────────────────────────────────────────────────

const EXCLUDE_DIR_SEGMENTS = [
  `${path.sep}theme${path.sep}`,
  // Skip the whole __tests__ tree, not just fixtures — rewriting hex inside
  // test assertions / props breaks the tests (revised 2026-05-29).
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
];

export function isExcluded(filePath: string): boolean {
  const normalised = filePath.includes(path.sep)
    ? filePath
    : filePath.split("/").join(path.sep);
  return EXCLUDE_DIR_SEGMENTS.some((seg) => normalised.includes(seg));
}

function isTarget(filePath: string): boolean {
  return /\.(ts|tsx)$/.test(filePath) && !/\.d\.ts$/.test(filePath);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, acc);
    } else if (isTarget(full) && !isExcluded(full)) {
      acc.push(full);
    }
  }
  return acc;
}

export type CodemodReport = {
  filesScanned: number;
  filesChanged: number;
  totalReplacements: number;
  perFile: { file: string; replacements: number }[];
};

/** Run the codemod over a directory tree. Writes only when `apply` is true. */
export function runCodemod(rootDir: string, apply: boolean): CodemodReport {
  const files = walk(rootDir);
  const report: CodemodReport = {
    filesScanned: files.length,
    filesChanged: 0,
    totalReplacements: 0,
    perFile: [],
  };

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const { output, replacements } = transformSource(source);
    if (replacements > 0) {
      report.filesChanged += 1;
      report.totalReplacements += replacements;
      report.perFile.push({ file, replacements });
      if (apply) writeFileSync(file, output, "utf8");
    }
  }

  return report;
}

// ─── CLI ──────────────────────────────────────────────────────────────

export function parseCodemodArgs(argv: string[]): {
  apply: boolean;
  dir: string;
} {
  let apply = false;
  let dir = "packages/mobile/src";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry") apply = false;
    else if (arg === "--dir") {
      const next = argv[i + 1];
      if (typeof next === "string" && next.length > 0) {
        dir = next;
        i += 1;
      }
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    }
  }
  return { apply, dir };
}

if (import.meta.main) {
  const { apply, dir } = parseCodemodArgs(process.argv.slice(2));
  const absDir = path.resolve(process.cwd(), dir);
  const report = runCodemod(absDir, apply);

  console.log(`# codemod-tokens report ${apply ? "(APPLIED)" : "(dry-run)"}`);
  console.log(`# dir: ${dir}`);
  console.log(`# files scanned: ${report.filesScanned}`);
  console.log(`# files changed: ${report.filesChanged}`);
  console.log(`# total replacements: ${report.totalReplacements}`);
  console.log("");
  for (const { file, replacements } of report.perFile) {
    const rel = path.relative(process.cwd(), file);
    console.log(`${replacements}\t${rel}`);
  }
  if (!apply) {
    console.log("");
    console.log("# dry-run — no files written. Re-run with --apply to write.");
  }
}

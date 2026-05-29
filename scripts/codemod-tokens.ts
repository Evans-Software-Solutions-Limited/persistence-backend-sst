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

/** Exact case-insensitive string → token replacements. */
export const HEX_REPLACEMENTS: { match: string[]; token: string }[] = [
  { match: ["#00D4FF"], token: "$primary" },
  { match: ["#FFFFFF", "#FFF", "white"], token: "$text" },
  { match: ["#FFD700", "#FFC700"], token: "$gold" },
  { match: ["#0A0A0F", "#0A0B12", "#0B0B12"], token: "$bg" },
];

/** Legacy primary as an rgb triple — used to recognise rgba() variants. */
const PRIMARY_RGB = { r: 0, g: 212, b: 255 };
/** Alpha at or below this maps to $primaryDim; above to $primaryGlow. */
const DIM_ALPHA_CEILING = 0.2;

/** JSX attribute names whose hex values are concrete colours for a non-Tamagui
 * consumer (SVG, LinearGradient, Ionicons, RN style props that don't resolve
 * Tamagui tokens). Any attribute ending in "Color" is also skipped. */
const SKIP_JSX_ATTRS = new Set([
  "fill",
  "stroke",
  "color",
  "colors",
  "tintColor",
  "placeholderTextColor",
]);

function isSkippedJsxAttr(name: string): boolean {
  return SKIP_JSX_ATTRS.has(name) || /Color$/.test(name);
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
  //   - `return "#..."` (e.g. resolveInk(tone) -> icon color)
  //   - object properties keyed `fg` / `bg` (tone-map entries consumed as
  //     icon/indicator colours)
  root.find(j.ReturnStatement).forEach((p) => {
    const arg = p.node.argument;
    if (!arg) return;
    // The argument may itself be the string literal, or contain literals.
    if (arg.type === "StringLiteral") skipNodes.add(arg);
    j(p.get("argument"))
      .find(j.StringLiteral)
      .forEach((s) => skipNodes.add(s.node));
  });
  root.find(j.ObjectProperty).forEach((p) => {
    const key = p.node.key;
    const keyName =
      key.type === "Identifier"
        ? key.name
        : key.type === "StringLiteral"
          ? key.value
          : null;
    if (keyName === "fg" || keyName === "bg") {
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

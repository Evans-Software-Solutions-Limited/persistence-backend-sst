import { parseNutritionValue } from "./parseNutritionValue";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { ParsedRecipe, ParsedNutrition } from "./parseRecipe";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const ignored = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "nav",
  "footer",
  "form",
  "aside",
]);
const element = (node: Node): node is Element => "tagName" in node;
const attribute = (node: Element, name: string) =>
  node.attrs.find((a) => a.name === name)?.value;
function hidden(node: Node): boolean {
  return (
    element(node) &&
    (ignored.has(node.tagName) ||
      attribute(node, "hidden") !== undefined ||
      attribute(node, "aria-hidden") === "true" ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        attribute(node, "style") ?? "",
      ))
  );
}
function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}
function elements(root: Node): Element[] {
  const result: Element[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (hidden(node)) continue;
    if (element(node)) result.push(node);
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index--)
      pending.push(nested[index]);
  }
  return result;
}
function text(root: Node, preserveLines = false): string {
  const parts: string[] = [];
  const pending: Array<Node | null> = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) {
      parts.push("\n");
      continue;
    }
    if (hidden(node)) continue;
    if (preserveLines && element(node) && /^(?:li|p)$/.test(node.tagName)) {
      parts.push("\n", text(node), "\n");
      continue;
    }
    if ("value" in node) parts.push(node.value.replace(/\s+/g, " "));
    else {
      if (
        element(node) &&
        /^(?:li|p|div|br|h[1-6]|ul|ol|section|article|header|main|table|tr|td|dd|dt)$/.test(
          node.tagName,
        )
      ) {
        parts.push(preserveLines ? "\n" : " ");
        if (preserveLines) pending.push(null);
      }
      const nested = children(node);
      for (let index = nested.length - 1; index >= 0; index--)
        pending.push(nested[index]);
    }
  }
  const result = parts.join("");
  return preserveLines
    ? result
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n")
    : result.replace(/\s+/g, " ").trim();
}
const headingLevel = (node: Element) =>
  /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0;
function section(nodes: Element[], heading: Element): Element[] {
  const scope = new Set(elements(heading.parentNode!));
  const start = nodes.indexOf(heading) + 1;
  let end = start;
  while (end < nodes.length && scope.has(nodes[end])) {
    const level = headingLevel(nodes[end]);
    if (
      level &&
      (level <= headingLevel(heading) ||
        /^(?:ingredients|method|instructions|directions|preparation(?: method)?)\s*:?$/i.test(
          text(nodes[end]),
        ))
    )
      break;
    end++;
  }
  return nodes.slice(start, end);
}
function lines(nodes: Element[]): string[] {
  const selected = new Set<Element>();
  const result: string[] = [];
  for (const node of nodes) {
    if (!/^(?:li|p)$/.test(node.tagName)) continue;
    let parent = node.parentNode;
    let nested = false;
    while (parent && element(parent)) {
      if (selected.has(parent)) {
        nested = true;
        break;
      }
      parent = parent.parentNode;
    }
    if (nested) continue;
    selected.add(node);
    const value = text(node);
    if (value) result.push(value);
  }
  return result;
}
function nutrition(nodes: Element[]): ParsedNutrition | null {
  const candidates = nodes.filter((node) =>
    /(?:^|\s)(?:macros|nutrition|nutrition-facts)(?:\s|$)/i.test(
      attribute(node, "class") ?? "",
    ),
  );
  for (const node of candidates) {
    const siblings = node.parentNode ? children(node.parentNode) : [];
    const index = siblings.indexOf(node);
    const next = siblings.slice(index + 1).find(element);
    const context = `${text(node)} ${next ? text(next) : ""}`;
    // Never reinterpret per-recipe totals as per-serving macros.
    if (
      !/per\s+serving/i.test(context) ||
      /per\s+(?:recipe|100\s*g)|whole\s+recipe/i.test(context)
    )
      continue;
    const value = text(node);
    const read = (label: string, unit: string): number | null => {
      const match = value.match(
        new RegExp(
          `(?:^|\\s)(\\d+(?:[.,]\\d+)*)\\s*${unit}\\s*${label}\\b`,
          "i",
        ),
      );
      return match ? parseNutritionValue(match[1]) : null;
    };
    const result = {
      kcal: read("(?:calories|kcal)", ""),
      proteinG: read("protein", "g"),
      carbsG: read("(?:carbs|carbohydrates)", "g"),
      fatG: read("fat", "g"),
    };
    if (Object.values(result).some((value) => value !== null)) return result;
  }
  return null;
}

/** Conservative fallback for plain HTML recipes. Does not run page scripts or guess quantities. */
export function parseVisibleRecipe(html: string): ParsedRecipe | null {
  const nodes = elements(parse(html));
  const titles = nodes.filter((node) => node.tagName === "h1");
  const ingredientsHeadings = nodes.filter(
    (node) => headingLevel(node) && /^ingredients\s*:?$/i.test(text(node)),
  );
  const methodHeadings = nodes.filter(
    (node) =>
      headingLevel(node) &&
      /^(?:method|instructions|directions|preparation(?: method)?)\s*:?$/i.test(
        text(node),
      ),
  );
  // Multiple recipes are ambiguous: leave the page for manual review instead of mixing them.
  if (
    titles.length !== 1 ||
    ingredientsHeadings.length !== 1 ||
    methodHeadings.length !== 1
  )
    return null;
  const name = text(titles[0]);
  const ingredients = lines(section(nodes, ingredientsHeadings[0]));
  const instructions = lines(section(nodes, methodHeadings[0]));
  if (!name || ingredients.length < 2 || !instructions.length) return null;
  // Only metadata immediately under the recipe title can describe this recipe.
  // Later cards/sidebars may publish nutrition for entirely different dishes.
  const header = nodes.slice(
    nodes.indexOf(titles[0]) + 1,
    nodes.indexOf(ingredientsHeadings[0]),
  );
  const nextHeading = header.findIndex((node) => headingLevel(node) > 0);
  const metadata = nextHeading < 0 ? header : header.slice(0, nextHeading);
  const yields = new Set(
    metadata
      .filter((node) => /^(?:p|span)$/.test(node.tagName))
      .map(
        (node) =>
          text(node).match(
            /^(?:serves|servings\s*:?|yield\s*:)\s*(\d+)\s*(?:servings|people|portions)?\s*$/i,
          )?.[1],
      )
      .filter(Boolean)
      .map(Number),
  );
  const servings = yields.size === 1 ? [...yields][0] : null;
  return {
    extractionMethod: "page",
    name,
    ingredients,
    instructions: instructions.join("\n"),
    servings: servings && servings > 0 ? servings : null,
    nutrition: nutrition(metadata),
  };
}

/** Bounded page text; the extra character lets AI reject oversized pages rather than accept truncation. */
export function readableRecipeText(html: string, maxLength = 24001): string {
  return text(parse(html), true).slice(0, maxLength);
}

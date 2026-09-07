import type { ReactNode } from "react";

/**
 * A deliberately small markdown renderer for the one place the admin panel
 * shows markdown: a plan's pasted brief.
 *
 * ─── Why not a library ───
 *
 * `packages/web` has no markdown dependency, and this is a read-only display
 * of text one administrator pasted for themselves. A parser plus a sanitiser
 * is two dependencies and a permanent supply-chain surface for a panel with
 * one reader.
 *
 * ─── Why it never touches `dangerouslySetInnerHTML` ───
 *
 * Every branch below returns React ELEMENTS, so text is escaped by React and
 * raw HTML in the source renders as the literal characters it is. That is the
 * whole security argument, and it is structural rather than a filter that
 * could be got past: there is no path from source text to parsed HTML. The one
 * place a URL is honoured — a link's href — is checked against an
 * http/https/mailto allow-list, so a `javascript:` href cannot be produced
 * either.
 *
 * ─── What it covers ───
 *
 * Headings, paragraphs, bullet and numbered lists, tables, fenced code blocks,
 * blockquotes, horizontal rules, and inline bold / italic / code / links —
 * the shapes the milestone briefs in `specs/` actually use. Anything it does
 * not know is rendered as its own plain text rather than dropped, so a brief
 * is never silently truncated.
 */

type Inline = { text: string; key: number };

const LINK_SCHEME = /^(https?:|mailto:)/i;

/** Split inline markdown into React nodes. Order matters: code wins first. */
function renderInline(source: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass, one regex: code, bold, italic, link. Alternation is ordered so
  // `**bold**` is not eaten by the single-asterisk italic rule.
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) {
      nodes.push(source.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyBase}-i${index++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // Only http(s) and mailto. A `javascript:` or `data:` href would be an
      // executable link in a panel whose content is pasted text.
      nodes.push(
        LINK_SCHEME.test(href) ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isDivider = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

/**
 * Renders `source` as React elements. Returns `null` for empty input so the
 * caller can show its own "no brief yet" state.
 */
export function Markdown({ source }: { source: string | null | undefined }) {
  if (!source || source.trim().length === 0) return null;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    paragraph.length = 0;
    blocks.push(
      <p key={`p${key++}`} className="my-2 leading-relaxed">
        {renderInline(text, `p${key}`)}
      </p>,
    );
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim().length === 0) {
      flushParagraph();
      i += 1;
      continue;
    }

    // Fenced code — taken verbatim, never parsed for inline markdown.
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence, or end of input
      blocks.push(
        <pre
          key={`c${key++}`}
          className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-xs"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      const size =
        level === 1
          ? "text-lg font-semibold"
          : level === 2
            ? "text-base font-semibold"
            : "text-sm font-semibold";
      const Tag = `h${Math.min(level + 1, 6)}` as "h2";
      blocks.push(
        <Tag key={`h${key++}`} className={`mt-4 mb-1 ${size}`}>
          {renderInline(heading[2]!, `h${key}`)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={`r${key++}`} className="my-4 border-border" />);
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`q${key++}`}
          className="my-3 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderInline(quoted.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // Table: a pipe row followed by a `---|---` divider.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isDivider(lines[i + 1]!)
    ) {
      flushParagraph();
      const head = splitRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|")) {
        body.push(splitRow(lines[i]!));
        i += 1;
      }
      blocks.push(
        <div key={`t${key++}`} className="my-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {head.map((cell, c) => (
                  <th key={c} className="px-2 py-1 font-medium">
                    {renderInline(cell, `th${key}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="border-b border-border/60">
                  {row.map((cell, c) => (
                    <td key={c} className="px-2 py-1 align-top">
                      {renderInline(cell, `td${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      flushParagraph();
      const ordered = numbered.test(line);
      const items: Inline[] = [];
      let n = 0;
      while (
        i < lines.length &&
        (ordered ? numbered.test(lines[i]!) : bullet.test(lines[i]!))
      ) {
        items.push({
          text: lines[i]!.replace(ordered ? numbered : bullet, ""),
          key: n++,
        });
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={`l${key++}`}
          className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item) => (
            <li key={item.key}>
              {renderInline(item.text, `li${key}-${item.key}`)}
            </li>
          ))}
        </List>,
      );
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph();

  return <div className="text-sm">{blocks}</div>;
}

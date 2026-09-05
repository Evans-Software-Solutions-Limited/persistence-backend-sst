import { render, screen } from "@testing-library/react";
import { Markdown } from "../markdown";

describe("Markdown", () => {
  it("renders nothing for empty or whitespace-only input", () => {
    const { container } = render(<Markdown source={"   \n  "} />);
    expect(container.innerHTML).toBe("");
    expect(render(<Markdown source={null} />).container.innerHTML).toBe("");
  });

  it("renders headings at a level below the page's own h1", () => {
    render(<Markdown source={"# Brief\n## Section"} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Brief");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "Section",
    );
  });

  it("joins wrapped lines into one paragraph", () => {
    const { container } = render(
      <Markdown source={"A hard-wrapped\nsentence.\n\nSecond."} />,
    );
    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      "A hard-wrapped sentence.",
      "Second.",
    ]);
  });

  it("renders bullet and numbered lists", () => {
    const { container } = render(
      <Markdown source={"- one\n- two\n\n1. first\n2. second"} />,
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders a pipe table with its header row", () => {
    const { container } = render(
      <Markdown
        source={"| Lane | Rail |\n| --- | --- |\n| A | Grant |\n| B | Store |"}
      />,
    );
    expect(
      [...container.querySelectorAll("th")].map((c) => c.textContent),
    ).toEqual(["Lane", "Rail"]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("keeps a fenced code block verbatim, without parsing it as markdown", () => {
    const { container } = render(
      <Markdown source={"```\n# not a heading\n**not bold**\n```"} />,
    );
    expect(container.querySelector("pre code")?.textContent).toBe(
      "# not a heading\n**not bold**",
    );
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders inline bold, italic and code", () => {
    const { container } = render(
      <Markdown source={"**bold** and *italic* and `code`"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("does not let a bold run be eaten by the italic rule", () => {
    const { container } = render(<Markdown source="**both words**" />);
    expect(container.querySelector("strong")?.textContent).toBe("both words");
    expect(container.querySelector("em")).toBeNull();
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = render(<Markdown source={"> quoted\n\n---"} />);
    expect(container.querySelector("blockquote")?.textContent).toBe("quoted");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  describe("it can never inject HTML or an executable link", () => {
    it("renders raw HTML in the source as literal text", () => {
      // The whole security argument: every branch returns React elements, so
      // there is no path from source text to parsed HTML.
      const { container } = render(
        <Markdown source={'<img src=x onerror="alert(1)">'} />,
      );
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("<img src=x");
    });

    it("renders a script tag as text", () => {
      const { container } = render(
        <Markdown source={"<script>alert(1)</script>"} />,
      );
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).toContain("<script>");
    });

    it("keeps an http link but strips a javascript: href", () => {
      const { container } = render(
        <Markdown
          source={"[safe](https://example.com) [bad](javascript:alert(1))"}
        />,
      );
      const links = [...container.querySelectorAll("a")];
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute("href")).toBe("https://example.com");
      // The label survives — a brief is never silently truncated.
      expect(container.textContent).toContain("bad");
    });

    it("strips a data: href too", () => {
      const { container } = render(
        <Markdown source={"[x](data:text/html;base64,PHNjcmlwdD4=)"} />,
      );
      expect(container.querySelectorAll("a")).toHaveLength(0);
    });

    it("opens external links without handing over the opener", () => {
      const { container } = render(
        <Markdown source={"[safe](https://example.com)"} />,
      );
      expect(container.querySelector("a")?.getAttribute("rel")).toContain(
        "noopener",
      );
    });
  });

  it("renders an unclosed code fence rather than dropping the rest", () => {
    const { container } = render(<Markdown source={"```\nstill here"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("still here");
  });
});

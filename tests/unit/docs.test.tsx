import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import GithubSlugger from "github-slugger";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/docs/markdown";
import { resolveDocHref } from "@/lib/doc-links";
import { listDocs, loadDoc } from "@/lib/docs";

const docs = listDocs();
const known = new Set(docs.map((d) => d.file));
const html = (md: string, file = "docs/SDD.md") => renderToStaticMarkup(<Markdown source={md} file={file} known={known} />);

describe("documentation set", () => {
  it("lists README and every file in docs/, each with a title, a unique slug and a group", () => {
    expect(docs.map((d) => d.file)).toEqual(expect.arrayContaining(["README.md", "docs/PRD.md", "docs/SDD.md", "docs/SCENARIOS.md", "docs/TESTING.md", "docs/TROUBLESHOOTING.md", "docs/UCP_SPECIFICATION_MAPPING.md"]));
    expect(new Set(docs.map((d) => d.slug)).size).toBe(docs.length);
    for (const d of docs) {
      expect(d.title.length, d.file).toBeGreaterThan(2);
      expect(d.group, d.file).not.toBe("");
    }
  });
  it("covers the Phase 11 topics", () => {
    const text = docs.map((d) => d.title + readFileSync(d.file, "utf8")).join("\n").toLowerCase();
    for (const topic of ["version", "discovery", "checkout", "payment", "order", "webhook", "security", "testing", "troubleshooting", "scenario"]) expect(text, topic).toContain(topic);
  });
  it.each(docs.map((d) => [d.file, d.slug]))("%s renders to HTML without throwing", (file, slug) => {
    const d = loadDoc(slug)!;
    const out = html(d.markdown, file);
    expect(out.length).toBeGreaterThan(200);
    expect(out).not.toContain("<script");
  });
});

describe("links inside the docs resolve", () => {
  const slugger = (md: string) => {
    const s = new GithubSlugger();
    const ids = new Set<string>();
    let fence = false;
    for (const line of md.split("\n")) {
      if (/^```/.test(line)) fence = !fence;
      const m = !fence && /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
      if (m) ids.add(s.slug(m[1]!.replace(/[`*_]/g, "")));
    }
    return ids;
  };
  for (const d of docs) {
    it(`${d.file}: relative .md links point at real docs and real headings`, () => {
      const md = readFileSync(d.file, "utf8").replace(/```[\s\S]*?```/g, "");
      for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1]!;
        if (/^(https?:|mailto:)/.test(href)) continue;
        const r = resolveDocHref(href, d.file, known);
        if (href.startsWith("#")) {
          expect(slugger(readFileSync(d.file, "utf8")).has(href.slice(1)), `${d.file} → ${href}`).toBe(true);
        } else if (href.split("#")[0]!.toLowerCase().endsWith(".md")) {
          expect(r.kind, `${d.file} → ${href}`).toBe("doc");
          const hash = href.split("#")[1];
          if (hash && r.kind === "doc") {
            const target = [...known].find((f) => r.href.startsWith(`/docs/${loadDoc(listDocs().find((x) => x.file === f)!.slug)!.slug}`))!;
            expect(slugger(readFileSync(target, "utf8")).has(hash), `${d.file} → ${href}`).toBe(true);
          }
        }
      }
    });
  }
  it("files the README names under docs/ exist", () => {
    for (const m of readFileSync("README.md", "utf8").matchAll(/`(docs\/[A-Z_]+\.md)`/g)) expect(existsSync(m[1]!), m[1]).toBe(true);
  });
});

describe("the scenario guide stays in sync with the code", () => {
  const defs = readFileSync("src/app-services/scenarios/definitions.ts", "utf8");
  const guide = readFileSync("docs/SCENARIOS.md", "utf8");
  const ids = [...defs.matchAll(/^const \w+: ScenarioDef = \{\n  id: "([\w-]+)"/gm)].map((m) => m[1]!);
  it("documents all seven scenarios by id", () => {
    expect(ids).toHaveLength(7);
    for (const id of ids) expect(guide, id).toContain(`(\`${id}\`)`);
  });
  it("documents every step id of every scenario", () => {
    // split the source per scenario and the guide per section, then compare step ids
    const sections = guide.split(/^## \d+\. /m).slice(1);
    const scenarioSources = defs.split(/^const \w+: ScenarioDef = \{/m).slice(1);
    expect(sections).toHaveLength(7);
    scenarioSources.forEach((src, i) => {
      const stepIds = [...src.matchAll(/^\s*(?:\{ )?id: "(\w+)",\s*(?:\n\s*)?title:/gm)].map((m) => m[1]!);
      expect(stepIds.length).toBeGreaterThanOrEqual(4);
      for (const id of new Set(stepIds)) expect(sections[i], `${ids[i]} → step ${id}`).toContain(`\`${id}\``);
    });
  });
});

describe("markdown is rendered safely", () => {
  it("drops raw HTML, including scripts, event handlers and iframes", () => {
    const out = html('before <script>alert(1)</script> <img src=x onerror="alert(2)"> <iframe src="https://evil.example"></iframe> after\n\n<div onclick="x()">hi</div>');
    expect(out).not.toMatch(/<script|onerror|onclick|<iframe|<img/i);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });
  it("blocks javascript: and data: links and shows them as plain text", () => {
    const out = html("[a](javascript:alert(1)) [b](data:text/html,<b>x</b>) [c](JaVaScRiPt:alert(1)) [d](vbscript:x)");
    expect(out).not.toMatch(/href="(javascript|data|vbscript):/i);
    for (const t of ["a", "b", "c", "d"]) expect(out).toContain(t);
  });
  it("external links open safely", () => {
    const out = html("[x](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
  it("rewrites links between docs and renders links into the source tree as text", () => {
    const out = html("[a](UCP_RESEARCH.md#version-selection) [b](../README.md) [c](src/ucp/keys.ts) [d](SDD.md)", "docs/SDD.md");
    expect(out).toContain('href="/docs/ucp-research#version-selection"');
    expect(out).toContain('href="/docs/readme"');
    expect(out).toContain('href="/docs/sdd"');
    expect(out).not.toContain('href="src/ucp/keys.ts"');
    expect(out).not.toContain("[object Object]"); // hast nodes are never leaked into the DOM
  });
  it("resolveDocHref covers the edge cases", () => {
    expect(resolveDocHref("../../etc/passwd.md", "docs/SDD.md", known).kind).toBe("none");
    expect(resolveDocHref(undefined, "docs/SDD.md", known).kind).toBe("none");
    expect(resolveDocHref("#x", "docs/SDD.md", known)).toEqual({ kind: "anchor", href: "#x" });
    expect(resolveDocHref("file:///etc/passwd", "docs/SDD.md", known).kind).toBe("none");
    expect(resolveDocHref("missing.md", "docs/SDD.md", known).kind).toBe("none");
  });
  it("renders tables (GFM) inside a scroll container, with heading ids for anchors", () => {
    const out = html("## Hello World\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("<table");
    expect(out).toContain('id="hello-world"');
  });
  it("labels mermaid blocks as diagram source instead of silently showing code", () => {
    expect(html("```mermaid\nflowchart LR\n  A-->B\n```")).toContain("Mermaid diagram source");
  });
});

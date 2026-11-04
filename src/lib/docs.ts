import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import GithubSlugger from "github-slugger";
import { slugFor } from "./docs-slug";

/**
 * Project documentation, rendered in the app. The files in docs/ (plus README.md) are the single source of truth: there is
 * no second copy to drift. Pages are generated at build time, so no filesystem access is needed at runtime on Vercel.
 */
export interface DocMeta {
  slug: string;
  /** Path relative to the repository root. */
  file: string;
  title: string;
  group: string;
}

const ROOT = process.cwd();
const GROUPS: [string, string[]][] = [
  ["Start here", ["README.md", "PRD.md", "SCENARIOS.md"]],
  ["Protocol", ["UCP_RESEARCH.md", "UCP_SPECIFICATION_MAPPING.md", "UCP_CAPABILITY_MATRIX.md", "UCP_GLOSSARY.md"]],
  ["Design", ["SDD.md", "ARCHITECTURE.md", "API_DESIGN.md", "SECURITY_DESIGN.md"]],
  ["Delivery", ["IMPLEMENTATION_PLAN.md", "TESTING.md", "TROUBLESHOOTING.md"]],
];

export { slugFor };

const titleOf = (md: string, fallback: string) => md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;

export function listDocs(): DocMeta[] {
  const files = ["README.md", ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
  const groupOf = (file: string) => GROUPS.find(([, names]) => names.includes(file.split("/").at(-1)!))?.[0] ?? "Other";
  const order = (file: string) => {
    const gi = GROUPS.findIndex(([, n]) => n.includes(file.split("/").at(-1)!));
    const ni = gi >= 0 ? GROUPS[gi]![1].indexOf(file.split("/").at(-1)!) : 99;
    return (gi < 0 ? 99 : gi) * 100 + ni;
  };
  return files
    .map((file) => ({ slug: slugFor(file), file, title: titleOf(readFileSync(join(ROOT, file), "utf8"), file), group: groupOf(file) }))
    .sort((a, b) => order(a.file) - order(b.file) || a.file.localeCompare(b.file));
}

export interface Doc extends DocMeta {
  markdown: string;
  toc: { level: 2 | 3; text: string; id: string }[];
}

export function loadDoc(slug: string): Doc | null {
  const meta = listDocs().find((d) => d.slug === slug);
  if (!meta) return null;
  const markdown = readFileSync(join(ROOT, meta.file), "utf8");
  const slugger = new GithubSlugger();
  const toc: Doc["toc"] = [];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/[`*_]/g, "");
    const id = slugger.slug(text);
    if (m[1]!.length > 1) toc.push({ level: m[1]!.length as 2 | 3, text, id });
  }
  return { ...meta, markdown, toc };
}

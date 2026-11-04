import { slugFor } from "./docs-slug";

export type ResolvedLink = { kind: "external"; href: string } | { kind: "doc"; href: string } | { kind: "anchor"; href: string } | { kind: "none" };

/**
 * Rewrite a markdown link found inside `fromFile` (repo-relative, e.g. "docs/SDD.md").
 *  - http(s)/mailto stay external; `#x` stays an in-page anchor
 *  - a link to another doc (`UCP_RESEARCH.md`, `docs/SDD.md#x`, `../README.md`) becomes `/docs/<slug>#x`
 *  - links into the source tree (`src/...`) have no page to open, so they are rendered as plain text
 */
export function resolveDocHref(href: string | undefined, fromFile: string, known: ReadonlySet<string>): ResolvedLink {
  if (!href) return { kind: "none" };
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", href };
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "none" }; // javascript:, data:, file: …
  const [pathPart, hash] = href.split("#") as [string, string | undefined];
  if (!pathPart.toLowerCase().endsWith(".md")) return { kind: "none" };
  const base = fromFile.split("/").slice(0, -1);
  const parts = [...(pathPart.startsWith("/") ? [] : base), ...pathPart.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  const target = out.join("/");
  return known.has(target) ? { kind: "doc", href: `/docs/${slugFor(target)}${hash ? `#${hash}` : ""}` } : { kind: "none" };
}

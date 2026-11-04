import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { resolveDocHref } from "@/lib/doc-links";

/** react-markdown passes the hast `node` to every override; it must not be spread onto DOM elements. */
function clean<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const { node: _node, ...rest } = props;
  void _node;
  return rest;
}

/**
 * Safe markdown for project docs: raw HTML in the source is dropped (never rendered), unsafe URL schemes are blocked by
 * react-markdown's URL transform plus our own link resolver, and links into the source tree are shown as plain text.
 */
export function Markdown({ source, file, known }: { source: string; file: string; known: ReadonlySet<string> }) {
  return (
    <div className="docs-body text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        skipHtml
        components={{
          h1: (p) => <h1 className="mb-4 mt-2 text-2xl font-semibold tracking-tight" {...clean(p)} />,
          h2: (p) => <h2 className="mb-3 mt-8 scroll-mt-20 border-b pb-1 text-xl font-semibold tracking-tight" {...clean(p)} />,
          h3: (p) => <h3 className="mb-2 mt-6 scroll-mt-20 text-base font-semibold" {...clean(p)} />,
          h4: (p) => <h4 className="mb-1 mt-4 font-semibold" {...clean(p)} />,
          p: (p) => <p className="my-3" {...clean(p)} />,
          ul: (p) => <ul className="my-3 list-disc space-y-1 pl-6" {...clean(p)} />,
          ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-6" {...clean(p)} />,
          blockquote: (p) => <blockquote className="my-3 border-l-4 pl-4 text-muted-foreground" {...clean(p)} />,
          hr: () => <hr className="my-6" />,
          a: ({ href, children }) => {
            const r = resolveDocHref(href, file, known);
            if (r.kind === "none") return <span>{children}</span>;
            if (r.kind === "external") return <a href={r.href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{children}</a>;
            if (r.kind === "anchor") return <a href={r.href} className="text-primary underline-offset-2 hover:underline">{children}</a>;
            return <Link href={r.href} className="text-primary underline-offset-2 hover:underline">{children}</Link>;
          },
          table: (p) => (
            <div className="my-4 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-left text-xs" {...clean(p)} />
            </div>
          ),
          thead: (p) => <thead className="bg-muted/50" {...clean(p)} />,
          th: (p) => <th className="border-b px-3 py-2 font-medium" {...clean(p)} />,
          td: (p) => <td className="border-b px-3 py-2 align-top" {...clean(p)} />,
          pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed" tabIndex={0}>{children}</pre>,
          code: ({ className, children, ...props }) => {
            const rest = clean(props);
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            if (lang === "mermaid") return <code data-diagram-source="mermaid" {...rest}>{`(Mermaid diagram source: rendered as text here)\n${String(children)}`}</code>;
            return className ? <code className={className} {...rest}>{children}</code> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>{children}</code>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

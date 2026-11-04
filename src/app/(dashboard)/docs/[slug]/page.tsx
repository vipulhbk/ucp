import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Markdown } from "@/components/docs/markdown";
import { listDocs, loadDoc } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return listDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">) {
  const doc = loadDoc((await params).slug);
  return { title: doc ? `${doc.title} · UCP Playground` : "Documentation" };
}

export default async function DocPage({ params }: PageProps<"/docs/[slug]">) {
  const doc = loadDoc((await params).slug);
  if (!doc) notFound();
  const known = new Set(listDocs().map((d) => d.file));
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <article className="min-w-0">
        <Link href="/docs" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> All documents</Link>
        <p className="mb-2 font-mono text-xs text-muted-foreground">{doc.file}</p>
        <Markdown source={doc.markdown} file={doc.file} known={known} />
      </article>
      {doc.toc.length > 0 && (
        <nav aria-label="On this page" className="sticky top-4 hidden h-fit max-h-[80vh] overflow-y-auto text-xs lg:block">
          <div className="mb-2 font-medium text-muted-foreground">On this page</div>
          <ul className="space-y-1">
            {doc.toc.map((t) => (
              <li key={t.id} className={t.level === 3 ? "pl-3" : ""}><a href={`#${t.id}`} className="text-muted-foreground hover:text-foreground">{t.text}</a></li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

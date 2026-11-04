import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listDocs } from "@/lib/docs";

export const metadata = { title: "Documentation · UCP Playground" };

export default function DocsIndex() {
  const docs = listDocs();
  const groups = [...new Set(docs.map((d) => d.group))];
  return (
    <>
      <PageHeader title="Documentation" description="The project's own documents, rendered from the files in the repository (no second copy). Start with the README, then the scenario guide." />
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{g}</CardTitle>
              <CardDescription>{docs.filter((d) => d.group === g).length} document(s)</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {docs.filter((d) => d.group === g).map((d) => (
                  <li key={d.slug}>
                    <Link href={`/docs/${d.slug}`} className="text-primary hover:underline" data-testid={`doc-${d.slug}`}>{d.title}</Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{d.file}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

import { notFound } from "next/navigation";

const PAGES: Record<string, { title: string; body: string }> = {
  terms: { title: "Terms of service (demo)", body: "This is a demonstration merchant. No goods are sold and no payment is taken." },
  privacy: { title: "Privacy policy (demo)", body: "Demo data is stored for 24 hours under an anonymous session and then deleted. Do not enter real personal data." },
  refunds: { title: "Refund policy (demo)", body: "Nothing is purchased in this demo, so there is nothing to refund." },
};

export default async function LegalPage({ params }: PageProps<"/legal/[slug]">) {
  const page = PAGES[(await params).slug];
  if (!page) notFound();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">{page.title}</h1>
      <p className="mt-3 text-muted-foreground">{page.body}</p>
    </main>
  );
}

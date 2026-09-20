import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/lib/i18n";

export type Bilingual = { en: string; ta: string };
export type LegalSection = { heading: Bilingual; body: Bilingual[] };

export function LegalPage({
  title,
  updated,
  sections,
}: {
  title: Bilingual;
  updated: string;
  sections: LegalSection[];
}) {
  const { lang } = useI18n();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{title[lang]}</h1>
        <div className="gold-rule mt-4 w-28" />
        <p className="mt-3 text-xs text-muted-foreground">Last updated: {updated}</p>
        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.heading.en}>
              <h2 className="font-display text-xl font-semibold">{s.heading[lang]}</h2>
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
                {s.body.map((p, i) => (
                  <p key={i}>{p[lang]}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

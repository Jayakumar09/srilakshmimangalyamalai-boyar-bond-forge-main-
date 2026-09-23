import { Link } from "@tanstack/react-router";
import { ShieldCheck, BadgeCheck, HeartHandshake, Check } from "lucide-react";
import heroImage from "@/assets/hero-couple.jpg";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const points = {
  free: {
    en: ["Profile creation", "ID upload", "Browse profiles", "Receive interests"],
    ta: [
      "சுயவிவரம் உருவாக்கம்",
      "அடையாள அட்டை பதிவேற்றம்",
      "சுயவிவரங்களை உலாவுதல்",
      "விருப்பங்களைப் பெறுதல்",
    ],
  },
  std: {
    en: ["Everything in Starter", "Send interests", "Message matches", "1 year validity"],
    ta: [
      "தொடக்கத் திட்டத்தில் உள்ள அனைத்தும்",
      "விருப்பம் அனுப்புதல்",
      "பொருத்தங்களுக்கு செய்தி அனுப்புதல்",
      "ஒரு வருட செல்லுபடி",
    ],
  },
  prem: {
    en: ["Everything in Standard", "Priority admin support", "Featured listing", "1 year validity"],
    ta: [
      "சாதாரண திட்டத்தில் உள்ள அனைத்தும்",
      "முன்னுரிமை நிர்வாக உதவி",
      "சிறப்புப் பட்டியலில் இடம்",
      "ஒரு வருட செல்லுபடி",
    ],
  },
};

export function HomePage() {
  const { t, lang } = useI18n();

  const trust = [
    { icon: ShieldCheck, title: t("trust_1_t"), body: t("trust_1_d") },
    { icon: BadgeCheck, title: t("trust_2_t"), body: t("trust_2_d") },
    { icon: HeartHandshake, title: t("trust_3_t"), body: t("trust_3_d") },
  ];

  const plans = [
    { name: t("plan_free"), price: "₹0", body: t("plan_free_d"), points: points.free[lang] },
    {
      name: t("plan_std"),
      price: "₹2,000",
      body: t("plan_std_d"),
      points: points.std[lang],
      featured: true,
    },
    { name: t("plan_prem"), price: "₹5,000", body: t("plan_prem_d"), points: points.prem[lang] },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="hero-surface relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm tracking-[0.25em] uppercase opacity-80">
              srilakshmimangalyamalai.com
            </p>
            <h1 className="mt-5 font-display text-5xl leading-tight font-semibold sm:text-6xl md:text-7xl">
              {t("brand")}
            </h1>
            <p className="mt-2 font-display text-4xl font-semibold sm:text-5xl md:text-6xl">
              {t("brand_line2")}
            </p>
            <div className="gold-rule mt-6 w-32" />
            <p className="mt-5 max-w-lg text-base opacity-90 sm:text-lg">{t("tagline")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="secondary">
                <Link to="/auth" search={{ mode: "signup" }}>
                  {t("hero_cta")}
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/40 bg-transparent text-inherit hover:bg-white/10"
              >
                <a href="#verification">{t("hero_secondary")}</a>
              </Button>
            </div>
            <p className="mt-5 max-w-md text-sm opacity-75">{t("hero_note")}</p>
          </div>
          <div className="relative">
            <img
              src={heroImage}
              alt={t("hero_img_alt")}
              width={1408}
              height={1008}
              className="rounded-2xl shadow-[var(--shadow-lift)] ring-1 ring-white/20"
            />
          </div>
        </div>
      </section>

      <section id="verification" className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-5 md:grid-cols-3">
          {trust.map((item) => (
            <div key={item.title} className="card-elevated p-6">
              <item.icon className="size-7 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="plans" className="mx-auto max-w-6xl px-4 pb-8">
        <h2 className="font-display text-3xl font-semibold">{t("plans_title")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("plans_sub")}</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={
                p.featured
                  ? "card-elevated border-accent p-6 shadow-[var(--shadow-lift)]"
                  : "card-elevated p-6"
              }
            >
              <h3 className="font-display text-xl font-semibold">{p.name}</h3>
              <p className="mt-2 font-display text-3xl font-semibold text-primary">
                {p.price}
                <span className="text-sm font-normal text-muted-foreground">{t("year")}</span>
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{p.body}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 text-accent" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="card-elevated mt-6 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h3 className="font-display text-xl font-semibold">{t("jathagam")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("jathagam_d")}</p>
          </div>
          <p className="font-display text-2xl font-semibold text-primary">₹500</p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

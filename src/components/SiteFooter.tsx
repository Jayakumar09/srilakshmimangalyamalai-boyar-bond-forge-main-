import { useRouterState } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";

export function SiteFooter() {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const prefix = pathname === "/ta" || pathname.startsWith("/ta/") ? "/ta" : "";

  return (
    <footer className="mt-20 border-t border-border bg-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="font-display text-lg font-semibold">{t("brand")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        <div className="text-sm">
          <p className="font-semibold">{t("contact")}</p>
          <p className="mt-2 text-muted-foreground">vijayalakshmi@srilakshmimangalyamalai.com</p>
          <p className="text-muted-foreground">
            <a href="tel:+917639150271" className="hover:text-foreground">
              +91 76391 50271
            </a>{" "}
            · {t("phone_general")}
          </p>
          <p className="text-muted-foreground">
            <a
              href="https://wa.me/919042761438"
              target="_blank"
              rel="noopener"
              className="hover:text-foreground"
            >
              +91 90427 61438
            </a>{" "}
            · {t("phone_whatsapp_only")}
          </p>
        </div>
        <div className="text-sm">
          <div className="flex flex-col gap-1">
            <a href={`${prefix}/terms`} className="text-muted-foreground hover:text-foreground">
              {t("terms")}
            </a>
            <a href={`${prefix}/privacy`} className="text-muted-foreground hover:text-foreground">
              {t("privacy")}
            </a>
            <a
              href={`${prefix}/refund-policy`}
              className="text-muted-foreground hover:text-foreground"
            >
              {t("refund")}
            </a>
          </div>
          <LanguageToggle className="mt-4" />
        </div>
      </div>
      <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} srilakshmimangalyamalai.com — {t("rights")}
      </div>
    </footer>
  );
}

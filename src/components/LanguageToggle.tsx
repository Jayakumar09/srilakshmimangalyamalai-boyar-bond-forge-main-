import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/** Pages that exist as a full Tamil twin under /ta. */
const TWINS = [
  "/",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/register",
  "/dashboard",
  "/jathagam",
  "/support",
];

export function toEnglishPath(pathname: string) {
  if (pathname === "/ta") return "/";
  if (pathname.startsWith("/ta/")) return pathname.slice(3);
  return pathname;
}

export function toTamilPath(pathname: string) {
  const en = toEnglishPath(pathname);
  if (!TWINS.includes(en)) return null;
  return en === "/" ? "/ta" : `/ta${en}`;
}

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tamilHref = toTamilPath(pathname);
  const englishHref = toEnglishPath(pathname);

  if (!tamilHref) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-card p-0.5 text-xs font-semibold",
        className,
      )}
    >
      <a
        href={englishHref}
        onClick={() => setLang("en")}
        className={cn(
          "rounded-full px-3 py-1 transition-colors",
          lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
        )}
      >
        {t("lang_en")}
      </a>
      <a
        href={tamilHref}
        onClick={() => setLang("ta")}
        className={cn(
          "rounded-full px-3 py-1 transition-colors",
          lang === "ta" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
        )}
      >
        {t("lang_ta")}
      </a>
    </div>
  );
}

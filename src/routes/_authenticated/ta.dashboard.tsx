import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/pages/DashboardPage";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/ta/dashboard")({
  head: () => ({
    meta: [
      { title: "என் கணக்கு — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        name: "description",
        content: "உங்கள் சுயவிவர ஒப்புதல் நிலை மற்றும் உறுப்பினர் திட்டத்தைப் பாருங்கள்.",
      },
      { property: "og:title", content: "என் கணக்கு — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      { property: "og:description", content: "சுயவிவர ஒப்புதல் நிலையைப் பாருங்கள்." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/dashboard" }],
  }),
  component: () => (
    <TamilPage>
      <DashboardPage />
    </TamilPage>
  ),
});

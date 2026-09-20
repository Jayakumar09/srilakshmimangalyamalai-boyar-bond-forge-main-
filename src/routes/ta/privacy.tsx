import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { privacySections, privacyTitle } from "@/content/legal";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/ta/privacy")({
  head: () => ({
    meta: [
      { title: "தனியுரிமைக் கொள்கை — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        name: "description",
        content:
          "உங்கள் சுயவிவரத் தகவல், அரசு அடையாள அட்டை மற்றும் ஆவணங்களை நாங்கள் எவ்வாறு சேகரித்து பாதுகாக்கிறோம்.",
      },
      { property: "og:title", content: "தனியுரிமைக் கொள்கை" },
      { property: "og:description", content: "உங்கள் தரவு எவ்வாறு கையாளப்படுகிறது." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/privacy" }],
  }),
  component: () => (
    <TamilPage>
      <LegalPage title={privacyTitle} updated="2026" sections={privacySections} />
    </TamilPage>
  ),
});

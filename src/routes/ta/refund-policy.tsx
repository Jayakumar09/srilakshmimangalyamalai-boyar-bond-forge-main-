import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { refundSections, refundTitle } from "@/content/legal";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/ta/refund-policy")({
  head: () => ({
    meta: [
      { title: "ரத்து மற்றும் பணத்திரும்பக் கொள்கை — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        name: "description",
        content: "சந்தா மற்றும் ஜாதக கட்டணங்கள் அனைத்தும் இறுதியானவை, திரும்பத் தரப்படாது.",
      },
      { property: "og:title", content: "ரத்து மற்றும் பணத்திரும்பக் கொள்கை" },
      { property: "og:description", content: "அனைத்து கட்டணங்களும் இறுதியானவை." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/refund-policy" }],
  }),
  component: () => (
    <TamilPage>
      <LegalPage title={refundTitle} updated="2026" sections={refundSections} />
    </TamilPage>
  ),
});

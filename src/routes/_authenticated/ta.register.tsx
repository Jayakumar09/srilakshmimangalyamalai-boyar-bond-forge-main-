import { createFileRoute } from "@tanstack/react-router";
import { RegisterWizard } from "@/components/pages/RegisterWizard";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/ta/register")({
  head: () => ({
    meta: [
      { title: "பதிவு — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        name: "description",
        content:
          "உங்கள் திருமண சுயவிவரத்தை நிறைவு செய்து, அரசு அடையாள அட்டையைப் பதிவேற்றி, நிர்வாக ஒப்புதலுக்கு சமர்ப்பிக்கவும்.",
      },
      { property: "og:title", content: "பதிவு — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        property: "og:description",
        content: "சுயவிவரத்தை நிறைவு செய்து நிர்வாக ஒப்புதலுக்கு சமர்ப்பிக்கவும்.",
      },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/register" }],
  }),
  component: () => (
    <TamilPage>
      <RegisterWizard />
    </TamilPage>
  ),
});

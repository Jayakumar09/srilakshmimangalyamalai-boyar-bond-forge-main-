import { createFileRoute } from "@tanstack/react-router";
import { JathagamAdminPage } from "@/components/pages/JathagamAdminPage";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/ta/jathagam")({
  head: () => ({
    meta: [
      { title: "ஜாதக அறிக்கைகள் — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        name: "description",
        content:
          "உறுப்பினர்களுக்கான சரிபார்க்கப்பட்ட ஜாதக அறிக்கைகளைப் பதிவேற்றி, செயல்படுத்தி, மின்னஞ்சல் அனுப்பவும்.",
      },
      { property: "og:title", content: "ஜாதக அறிக்கைகள் — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        property: "og:description",
        content: "உறுப்பினர்களுக்கு ஜாதக அறிக்கைகளை வழங்கவும்.",
      },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/jathagam" }],
  }),
  component: () => (
    <TamilPage>
      <JathagamAdminPage />
    </TamilPage>
  ),
});

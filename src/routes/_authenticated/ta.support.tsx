import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { SupportPage } from "@/components/pages/SupportPage";

export const Route = createFileRoute("/_authenticated/ta/support")({
  head: () => ({
    meta: [
      { title: "உதவி — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "சரிபார்ப்பு, கட்டணம், ஆவணங்கள் குறித்து அலுவலகத்துடன் தொடர்பு கொள்ளுங்கள்.",
      },
      { property: "og:title", content: "உதவி — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "உறுப்பினர் உதவி உரையாடல்கள்." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/support" }],
  }),
  component: () => (
    <TamilPage>
      <SupportPage />
    </TamilPage>
  ),
});

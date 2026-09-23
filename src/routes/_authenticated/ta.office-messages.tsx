import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { SupportPage } from "@/components/pages/SupportPage";

export const Route = createFileRoute("/_authenticated/ta/office-messages")({
  head: () => ({
    meta: [
      { title: "செய்திகள் — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "உறுப்பினர் உறுப்பினராக்கம், திட்டங்கள் மற்றும் கணக்கு பற்றிய அலுவலக செய்திகள்.",
      },
      { property: "og:title", content: "செய்திகள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "உறுப்பினர்களுக்கான அலுவலக செய்திகள்." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/office-messages" }],
  }),
  component: () => (
    <TamilPage>
      <SupportPage channel="messages" />
    </TamilPage>
  ),
});

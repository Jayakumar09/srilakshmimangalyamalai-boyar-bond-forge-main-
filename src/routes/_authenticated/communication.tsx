import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { SupportPage } from "@/components/pages/SupportPage";

export const Route = createFileRoute("/_authenticated/communication")({
  head: () => ({
    meta: [
      { title: "Communication — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "General correspondence and updates between the member and the office.",
      },
      { property: "og:title", content: "Communication — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Member communication with the office." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/communication" }],
  }),
  component: () => (
    <EnglishPage>
      <SupportPage channel="communication" />
    </EnglishPage>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { SupportPage } from "@/components/pages/SupportPage";

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({
    meta: [
      { title: "Support — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Message the office about verification, payments, documents or profile changes.",
      },
      { property: "og:title", content: "Support — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Member support conversations with the office." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/support" }],
  }),
  component: () => (
    <EnglishPage>
      <SupportPage />
    </EnglishPage>
  ),
});

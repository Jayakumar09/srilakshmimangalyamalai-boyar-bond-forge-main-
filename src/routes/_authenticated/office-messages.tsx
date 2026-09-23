import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { SupportPage } from "@/components/pages/SupportPage";

export const Route = createFileRoute("/_authenticated/office-messages")({
  head: () => ({
    meta: [
      { title: "Messages — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Office messages about membership, plans and account matters.",
      },
      { property: "og:title", content: "Messages — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Office messages with members." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/office-messages" }],
  }),
  component: () => (
    <EnglishPage>
      <SupportPage channel="messages" />
    </EnglishPage>
  ),
});

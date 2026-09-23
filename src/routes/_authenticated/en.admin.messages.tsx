import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/en/admin/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Office messages with members — administration area." },
      { property: "og:title", content: "Messages — Sri Lakshmi Mangalya Malai" },
      {
        property: "og:description",
        content: "Office messages with members — administration area.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/messages" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminClientMessages channel="messages" />
    </EnglishPage>
  ),
});

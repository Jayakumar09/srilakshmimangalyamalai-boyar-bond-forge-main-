import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/en/admin/messages")({
  head: () => ({
    meta: [
      { title: "Client messages — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Client support messages — administration area." },
      { property: "og:title", content: "Client messages — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Client support messages — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/messages" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminClientMessages />
    </EnglishPage>
  ),
});

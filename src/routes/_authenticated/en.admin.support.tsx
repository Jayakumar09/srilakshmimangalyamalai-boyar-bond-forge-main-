import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/en/admin/support")({
  head: () => ({
    meta: [
      { title: "Support — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Support conversations with members — administration area." },
      { property: "og:title", content: "Support — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Support conversations — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/support" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminClientMessages channel="support" />
    </EnglishPage>
  ),
});

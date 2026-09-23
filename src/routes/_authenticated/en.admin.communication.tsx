import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/en/admin/communication")({
  head: () => ({
    meta: [
      { title: "Communication — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Communication with members — administration area." },
      { property: "og:title", content: "Communication — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Communication with members — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/communication" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminClientMessages channel="communication" />
    </EnglishPage>
  ),
});

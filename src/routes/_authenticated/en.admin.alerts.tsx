import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminAlerts } from "@/components/pages/admin/AdminAlerts";

export const Route = createFileRoute("/_authenticated/en/admin/alerts")({
  head: () => ({
    meta: [
      { title: "Notifications — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Notifications — administration area." },
      { property: "og:title", content: "Notifications — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Notifications — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/alerts" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminAlerts />
    </EnglishPage>
  ),
});

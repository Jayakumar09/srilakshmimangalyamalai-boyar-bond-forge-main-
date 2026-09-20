import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminSettings } from "@/components/pages/admin/AdminSettings";

export const Route = createFileRoute("/_authenticated/en/admin/settings")({
  head: () => ({
    meta: [
      { title: "Admin settings — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Admin settings — administration area." },
      { property: "og:title", content: "Admin settings — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Admin settings — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/settings" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminSettings />
    </EnglishPage>
  ),
});

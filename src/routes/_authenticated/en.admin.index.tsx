import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminOverview } from "@/components/pages/admin/AdminOverview";

export const Route = createFileRoute("/_authenticated/en/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Admin Dashboard — administration area." },
      { property: "og:title", content: "Admin Dashboard — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Admin Dashboard — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminOverview />
    </EnglishPage>
  ),
});

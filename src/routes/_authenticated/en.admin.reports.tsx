import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminReports } from "@/components/pages/admin/AdminReports";

export const Route = createFileRoute("/_authenticated/en/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reports & blocks — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Reports & blocks — administration area." },
      { property: "og:title", content: "Reports & blocks — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Reports & blocks — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/reports" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminReports />
    </EnglishPage>
  ),
});

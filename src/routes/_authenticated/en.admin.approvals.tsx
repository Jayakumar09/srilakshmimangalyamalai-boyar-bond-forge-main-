import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminApprovals } from "@/components/pages/admin/AdminApprovals";

export const Route = createFileRoute("/_authenticated/en/admin/approvals")({
  head: () => ({
    meta: [
      { title: "Pending approvals — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Pending approvals — administration area." },
      { property: "og:title", content: "Pending approvals — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Pending approvals — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/approvals" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminApprovals />
    </EnglishPage>
  ),
});

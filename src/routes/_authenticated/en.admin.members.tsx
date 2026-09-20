import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminMembers } from "@/components/pages/admin/AdminMembers";

export const Route = createFileRoute("/_authenticated/en/admin/members")({
  head: () => ({
    meta: [
      { title: "Members — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Members — administration area." },
      { property: "og:title", content: "Members — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Members — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/members" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminMembers />
    </EnglishPage>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminJathagamRequests } from "@/components/pages/admin/AdminJathagamRequests";

export const Route = createFileRoute("/_authenticated/en/admin/jathagam")({
  head: () => ({
    meta: [
      { title: "Jathagam requests — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Jathagam requests — administration area." },
      { property: "og:title", content: "Jathagam requests — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Jathagam requests — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/jathagam" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminJathagamRequests />
    </EnglishPage>
  ),
});

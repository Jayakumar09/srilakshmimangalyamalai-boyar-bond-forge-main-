import { createFileRoute } from "@tanstack/react-router";
import { EnglishPage } from "@/lib/i18n";
import { AdminPayments } from "@/components/pages/admin/AdminPayments";

export const Route = createFileRoute("/_authenticated/en/admin/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Payments — administration area." },
      { property: "og:title", content: "Payments — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Payments — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/tn/admin/payments" }],
  }),
  component: () => (
    <EnglishPage>
      <AdminPayments />
    </EnglishPage>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import { AdminPayments } from "@/components/pages/admin/AdminPayments";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/payments")({
  head: () => ({
    meta: [
      { title: "கட்டணங்கள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "கட்டணங்கள் — administration area." },
      { property: "og:title", content: "கட்டணங்கள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "கட்டணங்கள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/payments" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminPayments />
    </TamilPage>
  )),
});

import { createFileRoute } from "@tanstack/react-router";
import { AdminAlerts } from "@/components/pages/admin/AdminAlerts";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/alerts")({
  head: () => ({
    meta: [
      { title: "அறிவிப்புகள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "அறிவிப்புகள் — administration area." },
      { property: "og:title", content: "அறிவிப்புகள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "அறிவிப்புகள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/alerts" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminAlerts />
    </TamilPage>
  )),
});

import { createFileRoute } from "@tanstack/react-router";
import { AdminJathagamRequests } from "@/components/pages/admin/AdminJathagamRequests";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/jathagam")({
  head: () => ({
    meta: [
      { title: "ஜாதக கோரிக்கைகள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "ஜாதக கோரிக்கைகள் — administration area." },
      { property: "og:title", content: "ஜாதக கோரிக்கைகள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "ஜாதக கோரிக்கைகள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/jathagam" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminJathagamRequests />
    </TamilPage>
  )),
});

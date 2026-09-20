import { createFileRoute } from "@tanstack/react-router";
import { AdminReports } from "@/components/pages/admin/AdminReports";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/reports")({
  head: () => ({
    meta: [
      { title: "புகார்கள் மற்றும் தடைகள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "புகார்கள் மற்றும் தடைகள் — administration area." },
      { property: "og:title", content: "புகார்கள் மற்றும் தடைகள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "புகார்கள் மற்றும் தடைகள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/reports" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminReports />
    </TamilPage>
  )),
});

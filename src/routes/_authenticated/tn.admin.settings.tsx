import { createFileRoute } from "@tanstack/react-router";
import { AdminSettings } from "@/components/pages/admin/AdminSettings";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/settings")({
  head: () => ({
    meta: [
      { title: "நிர்வாக அமைப்புகள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "நிர்வாக அமைப்புகள் — administration area." },
      { property: "og:title", content: "நிர்வாக அமைப்புகள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "நிர்வாக அமைப்புகள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/settings" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminSettings />
    </TamilPage>
  )),
});

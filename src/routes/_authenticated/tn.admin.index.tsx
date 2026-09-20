import { createFileRoute } from "@tanstack/react-router";
import { AdminOverview } from "@/components/pages/admin/AdminOverview";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/")({
  head: () => ({
    meta: [
      { title: "நிர்வாகப் பலகை — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "நிர்வாகப் பலகை — administration area." },
      { property: "og:title", content: "நிர்வாகப் பலகை — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "நிர்வாகப் பலகை — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminOverview />
    </TamilPage>
  )),
});

import { createFileRoute } from "@tanstack/react-router";
import { AdminApprovals } from "@/components/pages/admin/AdminApprovals";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/approvals")({
  head: () => ({
    meta: [
      { title: "ஒப்புதல் காத்திருப்பு — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "ஒப்புதல் காத்திருப்பு — administration area." },
      { property: "og:title", content: "ஒப்புதல் காத்திருப்பு — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "ஒப்புதல் காத்திருப்பு — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/approvals" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminApprovals />
    </TamilPage>
  )),
});

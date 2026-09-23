import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/tn/admin/support")({
  head: () => ({
    meta: [
      { title: "உதவி — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "உறுப்பினர்களுடனான உதவி உரையாடல்கள் — administration area." },
      { property: "og:title", content: "உதவி — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "உதவி உரையாடல்கள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/support" }],
  }),
  component: () => (
    <TamilPage>
      <AdminClientMessages channel="support" />
    </TamilPage>
  ),
});

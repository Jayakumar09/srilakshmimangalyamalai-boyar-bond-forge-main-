import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/tn/admin/messages")({
  head: () => ({
    meta: [
      { title: "செய்திகள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "உறுப்பினர்களுடனான அலுவலக செய்திகள் — administration area." },
      { property: "og:title", content: "செய்திகள் — Sri Lakshmi Mangalya Malai" },
      {
        property: "og:description",
        content: "உறுப்பினர்களுடனான அலுவலக செய்திகள் — administration area.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/messages" }],
  }),
  component: () => (
    <TamilPage>
      <AdminClientMessages channel="messages" />
    </TamilPage>
  ),
});

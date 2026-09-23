import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/tn/admin/communication")({
  head: () => ({
    meta: [
      { title: "தொடர்பு — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "உறுப்பினர்களுடனான தொடர்பு — administration area." },
      { property: "og:title", content: "தொடர்பு — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "உறுப்பினர்களுடனான தொடர்பு — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/communication" }],
  }),
  component: () => (
    <TamilPage>
      <AdminClientMessages channel="communication" />
    </TamilPage>
  ),
});

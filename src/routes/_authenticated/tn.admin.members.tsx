import { createFileRoute } from "@tanstack/react-router";
import { AdminMembers } from "@/components/pages/admin/AdminMembers";
import { TamilPage } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/tn/admin/members")({
  head: () => ({
    meta: [
      { title: "உறுப்பினர்கள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "உறுப்பினர்கள் — administration area." },
      { property: "og:title", content: "உறுப்பினர்கள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "உறுப்பினர்கள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/members" }],
  }),
  component: () => ((
    <TamilPage>
      <AdminMembers />
    </TamilPage>
  )),
});

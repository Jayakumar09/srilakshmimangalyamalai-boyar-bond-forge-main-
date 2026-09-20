import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { AdminClientMessages } from "@/components/pages/admin/AdminClientMessages";

export const Route = createFileRoute("/_authenticated/tn/admin/messages")({
  head: () => ({
    meta: [
      { title: "வாடிக்கையாளர் செய்திகள் — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "வாடிக்கையாளர் உதவி செய்திகள் — administration area." },
      { property: "og:title", content: "வாடிக்கையாளர் செய்திகள் — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "வாடிக்கையாளர் உதவி செய்திகள் — administration area." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/en/admin/messages" }],
  }),
  component: () => (
    <TamilPage>
      <AdminClientMessages />
    </TamilPage>
  ),
});

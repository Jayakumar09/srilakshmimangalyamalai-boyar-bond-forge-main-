import { createFileRoute } from "@tanstack/react-router";
import { JathagamAdminPage } from "@/components/pages/JathagamAdminPage";

export const Route = createFileRoute("/_authenticated/jathagam")({
  head: () => ({
    meta: [
      { title: "Horoscope reports — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Upload, activate and email verified Jathagam reports to members.",
      },
      { property: "og:title", content: "Horoscope reports — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Manage Jathagam report delivery for members." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/jathagam" }],
  }),
  component: JathagamAdminPage,
});

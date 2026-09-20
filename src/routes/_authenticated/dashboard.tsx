import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/pages/DashboardPage";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My account — Sri Lakshmi Mangalya Malai" },
      { name: "description", content: "Track your profile approval status and membership plan." },
      { property: "og:title", content: "My account — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Track your profile approval status." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/dashboard" }],
  }),
  component: DashboardPage,
});

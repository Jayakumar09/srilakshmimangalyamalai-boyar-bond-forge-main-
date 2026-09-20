import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/components/pages/HomePage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sri Lakshmi Mangalya Malai — Boyar Community Matrimony" },
      {
        name: "description",
        content:
          "Verified Boyar community matrimony. Government ID checks, AI pre-screening and manual admin approval.",
      },
      { property: "og:title", content: "Sri Lakshmi Mangalya Malai — Boyar Matrimony" },
      {
        property: "og:description",
        content: "Verified, admin-approved matrimony service for the Boyar community.",
      },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta" }],
  }),
  component: HomePage,
});

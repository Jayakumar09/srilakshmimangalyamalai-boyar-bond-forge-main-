import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { privacySections, privacyTitle } from "@/content/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content:
          "How Sri Lakshmi Mangalya Malai collects, stores and protects your profile data, government ID and documents.",
      },
      { property: "og:title", content: "Privacy Policy — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "How we handle your data and documents." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/privacy" }],
  }),
  component: () => <LegalPage title={privacyTitle} updated="2026" sections={privacySections} />,
});

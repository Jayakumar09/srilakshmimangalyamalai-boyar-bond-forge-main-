import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { termsSections, termsTitle } from "@/content/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content:
          "Membership terms, no-refund policy, information accuracy liability and Tamil Nadu jurisdiction for srilakshmimangalyamalai.com.",
      },
      { property: "og:title", content: "Terms & Conditions — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Membership terms and legal framework." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/terms" }],
  }),
  component: () => <LegalPage title={termsTitle} updated="2026" sections={termsSections} />,
});

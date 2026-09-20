import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { refundSections, refundTitle } from "@/content/legal";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: "Cancellation & Refund Policy — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content:
          "All subscription and Jathagam payments to Sri Lakshmi Mangalya Malai are final and strictly non-refundable.",
      },
      { property: "og:title", content: "Cancellation & Refund Policy" },
      { property: "og:description", content: "All payments are final and non-refundable." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/refund-policy" }],
  }),
  component: () => <LegalPage title={refundTitle} updated="2026" sections={refundSections} />,
});

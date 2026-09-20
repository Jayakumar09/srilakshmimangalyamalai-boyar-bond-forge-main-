import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/components/pages/HomePage";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/ta/")({
  head: () => ({
    meta: [
      { title: "ஸ்ரீ லட்சுமி மங்கல்ய மாலை — பொயர் சமுதாய திருமண சேவை" },
      {
        name: "description",
        content:
          "பொயர் சமுதாயத்திற்கான சரிபார்க்கப்பட்ட திருமண சேவை. அரசு அடையாள சரிபார்ப்பு, AI முன்சோதனை மற்றும் நிர்வாக ஒப்புதல்.",
      },
      { property: "og:title", content: "ஸ்ரீ லட்சுமி மங்கல்ய மாலை — பொயர் திருமண சேவை" },
      {
        property: "og:description",
        content: "பொயர் குடும்பங்களுக்கான நிர்வாக ஒப்புதல் பெற்ற திருமண சேவை.",
      },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/" }],
  }),
  component: () => (
    <TamilPage>
      <HomePage />
    </TamilPage>
  ),
});

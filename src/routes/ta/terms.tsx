import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { termsSections, termsTitle } from "@/content/legal";
import { TamilPage } from "@/lib/i18n";

export const Route = createFileRoute("/ta/terms")({
  head: () => ({
    meta: [
      { title: "விதிமுறைகள் மற்றும் நிபந்தனைகள் — ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
      {
        name: "description",
        content:
          "உறுப்பினர் விதிமுறைகள், பணம் திரும்பப் பெற முடியாத கொள்கை, தகவல் துல்லியப் பொறுப்பு மற்றும் தமிழ்நாடு நீதிமன்ற எல்லை.",
      },
      { property: "og:title", content: "விதிமுறைகள் மற்றும் நிபந்தனைகள்" },
      { property: "og:description", content: "உறுப்பினர் விதிமுறைகள் மற்றும் சட்டக் கட்டமைப்பு." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/terms" }],
  }),
  component: () => (
    <TamilPage>
      <LegalPage title={termsTitle} updated="2026" sections={termsSections} />
    </TamilPage>
  ),
});

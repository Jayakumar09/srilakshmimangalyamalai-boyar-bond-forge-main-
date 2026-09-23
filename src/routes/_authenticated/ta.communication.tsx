import { createFileRoute } from "@tanstack/react-router";
import { TamilPage } from "@/lib/i18n";
import { SupportPage } from "@/components/pages/SupportPage";

export const Route = createFileRoute("/_authenticated/ta/communication")({
  head: () => ({
    meta: [
      { title: "தொடர்பு — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "உறுப்பினருக்கும் அலுவலகத்திற்கும் இடையிலான பொது கடிதத் தொடர்பு.",
      },
      { property: "og:title", content: "தொடர்பு — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "உறுப்பினர் அலுவலகத் தொடர்பு." },
    ],
    links: [{ rel: "alternate", hrefLang: "en", href: "/communication" }],
  }),
  component: () => (
    <TamilPage>
      <SupportPage channel="communication" />
    </TamilPage>
  ),
});

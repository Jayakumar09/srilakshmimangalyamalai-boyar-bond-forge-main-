import { createFileRoute } from "@tanstack/react-router";
import { RegisterWizard } from "@/components/pages/RegisterWizard";

export const Route = createFileRoute("/_authenticated/register")({
  head: () => ({
    meta: [
      { title: "Registration — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Complete your matrimony profile, upload your ID and submit for admin approval.",
      },
      { property: "og:title", content: "Registration — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Complete your profile and submit for approval." },
    ],
    links: [{ rel: "alternate", hrefLang: "ta", href: "/ta/register" }],
  }),
  component: RegisterWizard,
});

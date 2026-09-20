import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  title?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

const Email = ({ title, body, ctaLabel, ctaUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{title || "Sri Lakshmi Mangalya Malai"}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={brand}>Sri Lakshmi Mangalya Malai</Text>
          <Text style={tagline}>Boyar community matrimony</Text>
        </Section>
        <Section style={card}>
          <Heading style={heading}>{title || "Update from your account"}</Heading>
          <Text style={paragraph}>{body || ""}</Text>
          {ctaUrl && (
            <Text style={paragraph}>
              <Link href={ctaUrl} style={link}>
                {ctaLabel || "Open the site"}
              </Link>
            </Text>
          )}
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          Sri Lakshmi Mangalya Malai · srilakshmimangalyamalai.com
          <br />
          General contact: +91 76391 50271 · WhatsApp calls only: +91 90427 61438
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Record<string, unknown>) =>
    (data["title"] as string) || "Sri Lakshmi Mangalya Malai",
  displayName: "Account notice",
  previewData: {
    title: "New profile submitted — Meena R",
    body: "Meena R submitted a profile for approval. Open the admin approval queue to review the ID, photo and AI pre-check.",
    ctaLabel: "Open admin queue",
    ctaUrl: "https://srilakshmimangalyamalai.com/admin",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Georgia, 'Times New Roman', serif" };
const container = { padding: "24px", maxWidth: "560px" };
const header = { textAlign: "center" as const, paddingBottom: "12px" };
const brand = { fontSize: "22px", color: "#5d1a1d", margin: "0", fontWeight: 600 };
const tagline = { fontSize: "12px", color: "#8a7a66", margin: "4px 0 0", letterSpacing: "1px" };
const card = {
  border: "1px solid #e8dfd0",
  borderRadius: "10px",
  padding: "24px",
  backgroundColor: "#fdfaf4",
};
const heading = { fontSize: "19px", color: "#5d1a1d", margin: "0 0 12px" };
const paragraph = {
  fontSize: "15px",
  lineHeight: "24px",
  color: "#3d3630",
  margin: "0 0 12px",
  fontFamily: "Arial, sans-serif",
};
const link = { color: "#b8860b", fontWeight: 600 };
const hr = { borderColor: "#e8dfd0", margin: "24px 0 12px" };
const footer = {
  fontSize: "12px",
  color: "#8a7a66",
  textAlign: "center" as const,
  fontFamily: "Arial, sans-serif",
};

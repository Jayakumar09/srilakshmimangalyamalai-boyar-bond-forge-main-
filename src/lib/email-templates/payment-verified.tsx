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
  fullName?: string;
  paymentId?: string;
  item?: string;
  amount?: number;
  verifiedAt?: string | null;
}

const Email = ({ fullName, paymentId, item, amount, verifiedAt }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your payment was verified — receipt available</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={brand}>Sri Lakshmi Mangalya Malai</Text>
          <Text style={tagline}>Boyar community matrimony</Text>
        </Section>
        <Section style={card}>
          <Heading style={heading}>Your payment was verified</Heading>
          <Text style={paragraph}>
            Dear {fullName || "Member"}, your {item || "payment"} of ₹{amount ?? 0} has been
            verified and your payment receipt is now available.
          </Text>
          {paymentId && <Text style={paragraph}>Payment ID: {paymentId}</Text>}
          {verifiedAt && (
            <Text style={paragraph}>
              Verified on:{" "}
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Kolkata",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(verifiedAt))}{" "}
              (IST)
            </Text>
          )}
          <Text style={paragraph}>
            <Link href="https://srilakshmimangalyamalai.com/checkout" style={link}>
              Open the Payments page to view and download your receipt
            </Link>
          </Text>
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
  subject: (data: Record<string, unknown>) => "Your payment was verified — receipt available",
  displayName: "Payment verified (client)",
  previewData: {
    fullName: "Meena R",
    paymentId: "c27051fb-0bf8-480c-8fa1-83527c211515",
    item: "premium",
    amount: 5000,
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
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  idImage: z.string().min(50),
  photoImage: z.string().min(50),
});

export type PreScreenResult = {
  faceMatch: boolean;
  faceMatchConfidence: number;
  idReadable: boolean;
  photoClear: boolean;
  idType: string;
  notes: string;
};

/** AI pre-screening: does the ID photo match the profile photo, and is the ID readable? */
export const preScreenDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<PreScreenResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI verification is not configured.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          {
            role: "system",
            content:
              "You verify matrimonial registrations in India. Image 1 is a government ID card scan (Aadhaar, PAN, Voter ID or Driving Licence). Image 2 is a profile photo. Judge whether the faces plausibly belong to the same person, whether the ID is readable and looks like a genuine format, and whether the profile photo is a clear single-person face photo. Reply with the tool schema only.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Image 1 = government ID. Image 2 = profile photo." },
              { type: "image_url", image_url: { url: data.idImage } },
              { type: "image_url", image_url: { url: data.photoImage } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report",
              description: "Report the verification outcome",
              parameters: {
                type: "object",
                properties: {
                  faceMatch: { type: "boolean" },
                  faceMatchConfidence: { type: "number" },
                  idReadable: { type: "boolean" },
                  photoClear: { type: "boolean" },
                  idType: { type: "string" },
                  notes: { type: "string" },
                },
                required: [
                  "faceMatch",
                  "faceMatchConfidence",
                  "idReadable",
                  "photoClear",
                  "idType",
                  "notes",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report" } },
      }),
    });

    if (res.status === 429) throw new Error("Too many checks right now. Please try again shortly.");
    if (res.status === 402) throw new Error("AI verification credits are exhausted.");
    if (!res.ok) throw new Error(`Verification failed (${res.status}).`);

    const json = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("Verification returned no result.");
    return JSON.parse(args) as PreScreenResult;
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const UploadInput = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  folder: z.enum(["photo", "govt_id", "divorce_doc", "payment_proof", "jathagam"]),
});

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

async function signR2(key: string, method: "PUT" | "GET", contentType?: string) {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Cloud storage is not configured yet.");
  }
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Expires=900`,
  );
  const signed = await client.sign(
    new Request(url, { method, headers: contentType ? { "content-type": contentType } : {} }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

/** Returns a short-lived direct upload URL for Cloudflare R2. */
export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UploadInput.parse(input))
  .handler(async ({ data, context }) => {
    const key = `${context.userId}/${data.folder}/${Date.now()}-${sanitize(data.fileName)}`;
    const uploadUrl = await signR2(key, "PUT", data.contentType);
    return { key, uploadUrl };
  });

const FOLDERS = ["photo", "govt_id", "divorce_doc", "payment_proof", "jathagam"] as const;

/**
 * Uploads a file through the server to Cloudflare R2.
 * Used instead of a direct browser PUT so the bucket needs no CORS rules.
 */
export const uploadFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Invalid upload request.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const file = data.get("file");
    const folder = String(data.get("folder") ?? "");
    if (!(file instanceof File)) throw new Error("No file received.");
    if (!(FOLDERS as readonly string[]).includes(folder)) throw new Error("Invalid folder.");
    if (file.size > 15 * 1024 * 1024) throw new Error("File is too large (max 15 MB).");

    const contentType = file.type || "application/octet-stream";
    const key = `${context.userId}/${folder}/${Date.now()}-${sanitize(file.name || "file")}`;
    const uploadUrl = await signR2(key, "PUT", contentType);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
    return { key, fileName: file.name, mimeType: contentType, sizeBytes: file.size };
  });

/** Returns a short-lived view URL. Owners and admins only. */
export const createViewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ key: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    let ownsFile = data.key.startsWith(`${context.userId}/`);
    if (!ownsFile) {
      // Horoscope reports are uploaded by the admin but belong to the member who ordered them.
      const { data: report } = await context.supabase
        .from("jathagam_requests")
        .select("id")
        .eq("report_key", data.key)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (report) ownsFile = true;
    }
    if (!ownsFile) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Not allowed");
    }
    return { url: await signR2(data.key, "GET") };
  });

/**
 * Base URL baked into Supabase confirmation/recovery email links.
 * Defaults to the origin the signup page was loaded from, so deployed
 * https://srilakshmimangalyamalai.com and local development both get a
 * link the device can open. Override with VITE_AUTH_REDIRECT_URL to
 * force a specific origin while testing.
 */
export function authRedirectOrigin(): string {
  const configured = import.meta.env["VITE_AUTH_REDIRECT_URL"];
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  return window.location.origin;
}
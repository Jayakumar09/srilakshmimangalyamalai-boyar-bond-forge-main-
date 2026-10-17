/** Literal object keys only: never decode, trim or normalize an authorized key. */
export function isCanonicalStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 300 || /[^A-Za-z0-9._/-]/.test(key)) return false;
  const segments = key.split("/");
  return segments.length >= 2 && segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function assertCanonicalStorageKey(key: string): void {
  if (!isCanonicalStorageKey(key)) throw new Error("Invalid storage key.");
}

/** Build the exact object path before AWS signing, with no URL interpretation of keys. */
export function storageObjectUrl(accountId: string, bucket: string, key: string): URL {
  assertCanonicalStorageKey(key);
  const path = `/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com${path}`);
  if (url.pathname !== path || url.hash || url.search) throw new Error("Invalid storage key.");
  url.searchParams.set("X-Amz-Expires", "900");
  return url;
}

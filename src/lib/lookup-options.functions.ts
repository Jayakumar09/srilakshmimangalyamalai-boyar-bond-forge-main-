import { supabase } from "@/integrations/supabase/client";

export type LookupCategory =
  | "sub_caste"
  | "profession"
  | "native_district"
  | "occupation"
  | "gothram"
  | "mother_tongue";

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Persist freshly typed lookup values into lookup_options AFTER a profile has
 * been saved successfully. Call from profile save handlers only — never while
 * the user is still typing.
 *
 * Guarantees:
 * - a value that already exists in its category is never re-inserted
 *   (comparison is case/whitespace-insensitive and per category)
 * - the display value is preserved exactly as typed (outer whitespace trimmed)
 * - UNIQUE (category, value_en) backstops exact-case race duplicates
 * - existing seeded values and stored profile rows are never modified
 */
export async function ensureLookupOptions(
  entries: { category: LookupCategory; value: string | null | undefined }[],
): Promise<void> {
  const wanted: { category: LookupCategory; value_en: string }[] = [];
  const seen = new Set<string>();
  for (const { category, value } of entries) {
    const clean = (value ?? "").trim();
    if (!clean) continue;
    const key = `${category}\u0000${normalize(clean)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ category, value_en: clean });
  }
  if (wanted.length === 0) return;

  await Promise.all(
    wanted.map(async ({ category, value_en }) => {
      const { data } = await supabase
        .from("lookup_options")
        .select("value_en")
        .eq("category", category);
      const target = normalize(value_en);
      if ((data ?? []).some((o) => normalize(o.value_en) === target)) return;
      try {
        await supabase.from("lookup_options").insert({ category, value_en });
      } catch {
        /* concurrent exact-case duplicate: UNIQUE (category, value_en) wins */
      }
    }),
  );
}

/** Collect the profile lookup columns out of a form/patch record. */
export function lookupValueEntries(
  rec: Record<string, unknown>,
): { category: LookupCategory; value: string | null | undefined }[] {
  const str = (k: string) => {
    const v = rec[k];
    return v == null ? null : String(v);
  };
  return [
    { category: "sub_caste", value: str("sub_caste") },
    { category: "gothram", value: str("gothram") },
    { category: "mother_tongue", value: str("mother_tongue") },
    { category: "native_district", value: str("native_district") },
    { category: "profession", value: str("profession") },
    { category: "occupation", value: str("father_occupation") },
    { category: "occupation", value: str("mother_occupation") },
  ];
}
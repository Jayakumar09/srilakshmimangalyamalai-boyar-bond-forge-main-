import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Option = { id: string; value_en: string; value_ta: string | null };

/**
 * Database-backed dropdown. Typing a value that does not exist yet saves it to
 * the shared list so every future member sees it.
 */
export function LookupSelect({
  category,
  label,
  value,
  onChange,
  required,
  anyLabel,
}: {
  category: "sub_caste" | "profession" | "native_district";
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  anyLabel?: string | undefined;
}) {
  const { lang, t } = useI18n();
  const [options, setOptions] = useState<Option[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => setQuery(value), [value]);

  async function load() {
    const { data } = await supabase
      .from("lookup_options")
      .select("id, value_en, value_ta")
      .eq("category", category)
      .order("value_en");
    setOptions(data ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 40);
    return options
      .filter(
        (o) =>
          o.value_en.toLowerCase().includes(q) || (o.value_ta ?? "").toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [options, query]);

  const exists = options.some((o) => o.value_en.toLowerCase() === query.trim().toLowerCase());

  async function addNew() {
    const value_en = query.trim();
    if (!value_en) return;
    await supabase.from("lookup_options").insert({ category, value_en });
    await load();
    onChange(value_en);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Label className="mb-1.5 block text-sm">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        value={query}
        placeholder={anyLabel && value === "" ? t(anyLabel) : t("type_to_add")}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {anyLabel && (
            <>
              <button
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-muted-foreground hover:bg-accent/30"
                onMouseDown={() => {
                  onChange("");
                  setQuery("");
                  setOpen(false);
                }}
              >
                {t(anyLabel)}
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/30"
              onMouseDown={() => {
                onChange(o.value_en);
                setQuery(o.value_en);
                setOpen(false);
              }}
            >
              {lang === "ta" && o.value_ta ? `${o.value_ta} (${o.value_en})` : o.value_en}
            </button>
          ))}
          {!exists && query.trim() !== "" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-1 w-full"
              onMouseDown={(e) => {
                e.preventDefault();
                void addNew();
              }}
            >
              {t("add_new")} “{query.trim()}”
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Option = { id: string; value_en: string; value_ta: string | null };

/**
 * Database-backed dropdown. Selecting an option (or "Other" with a custom
 * value) commits it to the form. New values are persisted into lookup_options
 * only when the profile is saved (see ensureLookupOptions), so a half-filled
 * page never writes partial entries into the shared list.
 */
export function LookupSelect({
  category,
  label,
  value,
  onChange,
  required,
  anyLabel,
  includeOther,
}: {
  category: "sub_caste" | "profession" | "native_district" | "occupation" | "gothram" | "mother_tongue";
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  anyLabel?: string | undefined;
  includeOther?: boolean | undefined;
}) {
  const { lang, t } = useI18n();
  const [options, setOptions] = useState<Option[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [otherChosen, setOtherChosen] = useState(false);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    setQuery(value);
    setShowList(false);
  }, [value]);

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

  /**
   * While returning to the predefined list from a custom value ("Choose from
   * the list"), show the full list instead of filtering by the pending custom
   * text, so the predefined options are immediately visible again.
   */
  const shown = useMemo(() => (showList ? options.slice(0, 40) : filtered), [showList, options, filtered]);

  /** The currently committed value matches a predefined option? */
  const committedExists = options.some(
    (o) => o.value_en.toLowerCase() === value.trim().toLowerCase(),
  );

  /** Does the typed query match a predefined option? (drives the "Add new" button) */
  const queryExists = options.some(
    (o) => o.value_en.toLowerCase() === query.trim().toLowerCase(),
  );

  /**
   * A saved value that does not match any predefined option is treated as a
   * custom/Other value. `showList` lets the user step back to the predefined
   * list even while a custom value is committed (see "Choose from the list"),
   * so the custom branch is suspended until they pick an option or re-choose
   * Other. The effect above also clears it whenever the committed value changes.
   */
  const isCustomValue = includeOther && value !== "" && !committedExists;

  /**
   * Commits a freshly typed value to the form. Persistence to lookup_options is
   * deferred to the profile save handler, so abandoned pages never write into
   * the shared list.
   */
  function addNew() {
    const value_en = query.trim();
    if (!value_en) return;
    onChange(value_en);
    setQuery(value_en);
    setOtherChosen(false);
    setShowList(false);
    setOpen(false);
  }

  if (includeOther && (otherChosen || (isCustomValue && !showList))) {
    return (
      <div className="relative">
        <Label className="mb-1.5 block text-sm">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        <Input
          value={query}
          placeholder={t("type_to_add")}
          autoFocus={otherChosen}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
          }}
        />
        <button
          type="button"
          className="mt-1 text-xs text-primary hover:underline"
          onClick={() => {
            setOtherChosen(false);
            setShowList(true);
            setOpen(true);
          }}
        >
          {t("other_pick_from_list")}
        </button>
      </div>
    );
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
          // Strict select-to-commit: typing only filters the list. The value is
          // saved exclusively when an option is picked (or a new one is added),
          // so partial searches like "o" / "ot" never get stored as the answer.
          setQuery(e.target.value);
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
                  setOtherChosen(false);
                  setShowList(false);
                  setOpen(false);
                }}
              >
                {t(anyLabel)}
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}
          {includeOther && (
            <button
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-muted-foreground hover:bg-accent/30"
              onMouseDown={() => {
                setOtherChosen(true);
                setShowList(false);
                setQuery("");
                onChange("");
                setOpen(false);
              }}
            >
              {t("other")}
            </button>
          )}
          {shown.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/30"
              onMouseDown={() => {
                onChange(o.value_en);
                setQuery(o.value_en);
                setOtherChosen(false);
                setShowList(false);
                setOpen(false);
              }}
            >
              {lang === "ta" && o.value_ta ? `${o.value_ta} (${o.value_en})` : o.value_en}
            </button>
          ))}
          {!queryExists && query.trim() !== "" && (
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

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Option = { id: string; value_en: string; value_ta: string | null };

/** "Other" is a UI-only action; it is never a real lookup option or field value. */
const isOther = (s: string) => s.trim().toLowerCase() === "other";

/** Field-specific label for the custom-entry panel (falls back to a generic one). */
const ENTER_NEW_LABEL: Record<string, string> = {
  sub_caste: "enter_new_sub_caste",
  gothram: "enter_new_gothram",
  mother_tongue: "enter_new_mother_tongue",
  profession: "enter_new_profession",
  occupation: "enter_new_occupation",
  job_details: "enter_new_job_details",
};

/**
 * Database-backed dropdown. Existing values are selectable options; "Other" opens
 * a separate custom-entry panel (label + input + Save) that commits a brand-new
 * value to the form. New values are persisted into lookup_options only when the
 * profile is saved (see ensureLookupOptions), so typing/abandoned pages never
 * write partial entries into the shared list.
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
  category: "sub_caste" | "profession" | "native_district" | "occupation" | "gothram" | "mother_tongue" | "job_details";
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
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(value);
    setOtherChosen(false);
    setCustomDraft("");
    setCustomError(null);
  }, [value]);

  async function load() {
    const { data } = await supabase
      .from("lookup_options")
      .select("id, value_en, value_ta")
      .eq("category", category)
      .order("value_en");
    // Persisted "Other" rows (if any) are ignored so the dropdown shows exactly
    // one UI-only "Other", generated below by includeOther.
    setOptions((data ?? []).filter((o) => !includeOther || !isOther(o.value_en)));
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

  const queryExists = options.some(
    (o) => o.value_en.toLowerCase() === query.trim().toLowerCase(),
  );

  /** Commits the typed filter text as a new value. "Other" itself is never stored. */
  function addNew() {
    const value_en = query.trim();
    if (!value_en || isOther(value_en)) return;
    onChange(value_en);
    setQuery(value_en);
    setOpen(false);
  }

  /** Select "Other": open the custom-entry panel without touching the form value. */
  function selectOther() {
    setOtherChosen(true);
    setOpen(false);
    setCustomDraft("");
    setCustomError(null);
    setQuery(t("other"));
  }

  function cancelCustom() {
    setOtherChosen(false);
    setCustomDraft("");
    setCustomError(null);
    setQuery(value);
    setOpen(false);
  }

  /** Confirm the custom value for the current form only (DB insert happens on profile save). */
  function saveCustom() {
    const value_en = customDraft.trim();
    if (!value_en || isOther(value_en)) {
      setCustomError(t("custom_value_required"));
      return;
    }
    onChange(value_en);
    setQuery(value_en);
    setOtherChosen(false);
    setCustomDraft("");
    setCustomError(null);
    setOpen(false);
  }

  const enterNewLabel = t(ENTER_NEW_LABEL[category] ?? "enter_new_item");

  return (
    <div>
      <Label className="mb-1.5 block text-sm">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="relative">
        <Input
          value={query}
          readOnly={otherChosen}
          placeholder={anyLabel && value === "" ? t(anyLabel) : t("type_to_add")}
          onChange={(e) => {
            // Typing only filters the list. The value is committed exclusively
            // when an option is picked, "Add" is clicked, or the custom-entry
            // panel Save is pressed — so partial text is never stored as the answer.
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (!otherChosen) setOpen(true);
          }}
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
                    setCustomDraft("");
                    setCustomError(null);
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
                onMouseDown={selectOther}
              >
                {t("other")}
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/30"
                onMouseDown={() => {
                  onChange(o.value_en);
                  setQuery(o.value_en);
                  setOtherChosen(false);
                  setCustomDraft("");
                  setCustomError(null);
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
      {otherChosen && (
        <div className="mt-2 rounded-md border border-border bg-card p-3">
          <Label className="mb-1.5 block text-sm">{enterNewLabel}</Label>
          <Input
            value={customDraft}
            autoFocus
            placeholder={t("type_to_add")}
            onChange={(e) => {
              setCustomDraft(e.target.value);
              if (customError) setCustomError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveCustom();
              }
            }}
          />
          {customError && <p className="mt-1 text-xs text-destructive">{customError}</p>}
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" size="sm" onClick={saveCustom}>
              {t("save")}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={cancelCustom}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

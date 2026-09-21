import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, countryNameCode } from "@/lib/country-codes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Searchable country-code selector + separate phone-number input supporting any
 * country. The ISO country drives per-country validation on save; the dial code
 * is never typed by the user (nothing arbitrary can enter the code).
 */
export function CountryCodePhoneField({
  label,
  iso,
  onIsoChange,
  local,
  onLocalChange,
  onLocalBlur,
  error,
  placeholder,
}: {
  label: string;
  iso: string;
  onIsoChange: (iso: string) => void;
  local: string;
  onLocalChange: (v: string) => void;
  onLocalBlur: (() => void) | undefined;
  error?: string | undefined;
  placeholder?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () =>
      COUNTRY_CODES.find((c) => c.iso === iso) ??
      COUNTRY_CODES.find((c) => c.iso === DEFAULT_COUNTRY_ISO)!,
    [iso],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter(
      (c) =>
        c.iso.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        countryNameCode(c.iso).toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div>
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      <div className="flex items-start gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-9 shrink-0 justify-between gap-1 px-3 font-normal"
            >
              <span className="whitespace-nowrap">
                <span className="mr-1.5">{selected.flag}</span>
                {selected.code}
              </span>
              <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[300px] p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search country or code…"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup>
                  {matches.map((c) => (
                    <CommandItem
                      key={c.iso}
                      value={`${countryNameCode(c.iso)} ${c.code}`}
                      onSelect={() => {
                        onIsoChange(c.iso);
                        setOpen(false);
                      }}
                    >
                      <span className="mr-2 w-6 text-sm">{c.flag}</span>
                      <span className="flex-1">{countryNameCode(c.iso)}</span>
                      <span className="text-muted-foreground">{c.code}</span>
                      {c.iso === selected.iso && <Check className="ml-1 size-3.5" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Input
          type="tel"
          inputMode="tel"
          maxLength={15}
          placeholder={placeholder ?? "Phone number"}
          value={local}
          onChange={(e) => onLocalChange(e.target.value.replace(/\D/g, "").slice(0, 15))}
          onBlur={onLocalBlur}
          className={cn("min-w-0 flex-1", error && "border-destructive")}
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
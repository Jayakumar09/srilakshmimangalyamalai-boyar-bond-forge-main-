import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { birthTimeParts } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const PERIODS = ["AM", "PM"] as const;

/**
 * Mobile-friendly 3-part birth time control:
 *   [ Hour 01-12 ] [ Minute 00-59 ] [ AM/PM ]
 * Emits the canonical "HH:MM AM/PM" storage form only when every part is
 * present and valid; incomplete or invalid input emits "" and reports an
 * error so the parent can block submission. Existing stored values in any
 * parseable form (e.g. "06:30 AM", "06:30", "1145", "12am") load correctly.
 */
export function TimeInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  required,
  onValidityChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  onValidityChange?: ((valid: boolean) => void) | undefined;
}) {
  const { t } = useI18n();
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [period, setPeriod] = useState<"AM" | "PM" | "">("");
  const editingRef = useRef(false);

  // Sync local parts from the stored value unless the user is actively typing.
  useEffect(() => {
    if (editingRef.current) return;
    const parts = birthTimeParts(value);
    setHour(parts.hour);
    setMinute(parts.minute);
    setPeriod(parts.period);
    const hasAny = parts.hour !== "" || parts.minute !== "" || parts.period !== "";
    onValidityChange?.(!hasAny || isValid(parts.hour, parts.minute, parts.period));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function isValid(h: string, m: string, p: string): boolean {
    const hNum = Number(h);
    const mNum = Number(m);
    return (
      h !== "" &&
      m !== "" &&
      p !== "" &&
      hNum >= 1 &&
      hNum <= 12 &&
      mNum >= 0 &&
      mNum <= 59
    );
  }

  function report(next: { hour: string; minute: string; period: string }) {
    const hasAny = next.hour !== "" || next.minute !== "" || next.period !== "";
    onValidityChange?.(!hasAny || isValid(next.hour, next.minute, next.period));
  }

  function setPart(part: "hour" | "minute" | "period", v: string) {
    editingRef.current = true;
    const next: { hour: string; minute: string; period: string } = { hour, minute, period };
    if (part === "hour") next.hour = v;
    if (part === "minute") next.minute = v;
    if (part === "period") next.period = v;
    setHour(next.hour);
    setMinute(next.minute);
    setPeriod(next.period as "AM" | "PM" | "");
    if (isValid(next.hour, next.minute, next.period)) {
      onChange(`${next.hour.padStart(2, "0")}:${next.minute.padStart(2, "0")} ${next.period}`);
    } else {
      onChange("");
    }
    report(next);
  }

  function handleBlur() {
    editingRef.current = false;
    const pad = (v: string) =>
      v.length === 1 && v >= "1" && v <= "9" ? `0${v}` : v;
    const nextHour = pad(hour);
    const nextMinute = pad(minute);
    if (nextHour !== hour) setHour(nextHour);
    if (nextMinute !== minute) setMinute(nextMinute);
    onBlur?.();
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-muted-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive">*</span>
        )}
      </span>
      <div className="flex items-end gap-2">
        <div className="w-16">
          <span className="mb-1 block text-xs text-muted-foreground">{t("hour")}</span>
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            placeholder="06"
            value={hour}
            aria-label={t("hour")}
            aria-invalid={Boolean(error)}
            onChange={(e) =>
              setPart("hour", e.target.value.replace(/\D/g, "").slice(0, 2))
            }
            onBlur={handleBlur}
          />
        </div>
        <span className="pb-2 text-muted-foreground">:</span>
        <div className="w-16">
          <span className="mb-1 block text-xs text-muted-foreground">{t("minute")}</span>
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            placeholder="30"
            value={minute}
            aria-label={t("minute")}
            aria-invalid={Boolean(error)}
            onChange={(e) =>
              setPart("minute", e.target.value.replace(/\D/g, "").slice(0, 2))
            }
            onBlur={handleBlur}
          />
        </div>
        <div>
          <span className="mb-1 block text-xs text-muted-foreground">{t("time_period")}</span>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPart("period", p)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  period === p
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent/20"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
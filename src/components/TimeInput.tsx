import { Input } from "@/components/ui/input";

export function TimeInput({
  label,
  value,
  onChange,
  onBlur,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: (() => void) | undefined;
  error?: string | undefined;
}) {
  return (
    <div>
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
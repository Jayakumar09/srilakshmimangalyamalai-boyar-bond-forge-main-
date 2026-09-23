const IST_TZ = "Asia/Kolkata";

const fmtDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const fmtTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Formats a UTC timestamp as Indian Standard Time (Asia/Kolkata), e.g.
 * "24/09/2026, 04:15 pm". The backend stores UTC; every office conversation
 * (support / messages / communication) and the notification body display IST.
 */
export function formatIST(date: string | number | Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "--";
  return fmtDateTime.format(d);
}

/** Formats only the time-of-day in IST, e.g. "04:15 pm". */
export function formatISTTime(date: string | number | Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "--";
  return fmtTime.format(d);
}

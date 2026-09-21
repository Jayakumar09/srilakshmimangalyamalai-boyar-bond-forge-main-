/**
 * Display labels resolved from stable internal IDs, never from stored text.
 * Member-entered data (names, cities, notes) is never translated here.
 */
type T = (key: string) => string;

const PLAN_KEYS: Record<string, string> = {
  free: "plan_item_free",
  community_starter: "plan_item_free",
  standard: "plan_item_standard",
  premium: "plan_item_premium",
  jathagam: "plan_item_jathagam",
  horoscope_report: "plan_item_jathagam",
};

const STATUS_KEYS: Record<string, string> = {
  pending: "st_pending",
  approved: "st_approved",
  rejected: "st_rejected",
  submitted: "st_submitted",
  verified: "st_verified",
  open: "st_open",
  closed: "st_closed",
  ready: "st_ready",
  uploaded: "st_uploaded",
  suspended: "st_suspended",
};

const METHOD_KEYS: Record<string, string> = {
  online: "method_online",
  razorpay: "method_online",
  manual: "method_manual",
  upi: "method_manual",
};

export function planLabel(t: T, item: string | null | undefined) {
  if (!item) return "—";
  const key = PLAN_KEYS[item.toLowerCase()];
  return key ? t(key) : item;
}

export function statusLabel(t: T, status: string | null | undefined) {
  if (!status) return "—";
  const key = STATUS_KEYS[status.toLowerCase()];
  return key ? t(key) : status;
}

/** status 'pending' with no submission counts as a draft, not a pending approval. */
export function isProfileDraft(p: {
  status?: string | null;
  submitted_at?: string | null;
}): boolean {
  return p.status === "pending" && !p.submitted_at;
}

export function methodLabel(t: T, method: string | null | undefined) {
  if (!method) return "—";
  const key = METHOD_KEYS[method.toLowerCase()];
  return key ? t(key) : method;
}

export function createdByLabel(t: T, createdBy: string | null | undefined) {
  return createdBy === "admin" ? t("adm_admin_created") : t("adm_client_created");
}

export function actorLabel(t: T, actorType: string | null | undefined) {
  return actorType === "admin" ? t("adm_actor_admin") : t("adm_actor_client");
}

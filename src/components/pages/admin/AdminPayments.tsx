import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { memberName, useAdminData } from "@/lib/admin-data";
import { methodLabel, planLabel, statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminPayments() {
  const { t } = useI18n();
  const d = useAdminData();
  const [status, setStatus] = useState("all");
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (d.allowed === null || !d.allowed) return null;

  const rows = d.payments.filter((p) => status === "all" || p.status === status);

  return (
    <AdminShell active="payments" title={t("admin_payments")}>
      <SectionCard title={t("admin_payments")}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{t("adm_all")}</option>
            <option value="submitted">{t("st_submitted")}</option>
            <option value="verified">{t("st_verified")}</option>
            <option value="rejected">{t("st_rejected")}</option>
          </select>
          <span className="ml-auto text-sm text-muted-foreground">{rows.length}</span>
        </div>

        <div className="mt-4">
          {d.loading ? (
            <p className="text-sm text-muted-foreground">{t("adm_loading")}</p>
          ) : rows.length === 0 ? (
            <EmptyState title={t("adm_empty_payments")} description={t("adm_empty_payments_d")} />
          ) : (
            <DataTable
              head={[
                t("adm_member"),
                t("adm_plan"),
                t("adm_amount"),
                t("adm_method"),
                t("adm_date"),
                t("adm_status"),
                t("adm_actions"),
              ]}
            >
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-2 pr-4 font-medium">{memberName(d.profiles, p.user_id)}</td>
                  <td className="py-2 pr-4">{planLabel(t, p.item)}</td>
                  <td className="py-2 pr-4">₹{p.amount_inr.toLocaleString("en-IN")}</td>
                  <td className="py-2 pr-4">
                    {methodLabel(t, p.method)}
                    {p.utr_reference && (
                      <span className="block text-xs text-muted-foreground">UTR {p.utr_reference}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={toneForStatus(p.status)}>{statusLabel(t, p.status)}</StatusBadge>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {p.proof_key && (
                        <Button size="sm" variant="secondary" onClick={() => d.openDoc(p.proof_key!)}>
                          {t("adm_view")}
                        </Button>
                      )}
                      {p.status === "verified" && d.deliveries[p.id] && (
                        <>
                          {(d.deliveries[p.id]?.receipt_status !== "generated" ||
                            d.deliveries[p.id]?.notification_status !== "sent") && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={d.busy}
                              onClick={() => d.retryDelivery(p.id)}
                            >
                              {t("adm_retry_delivery")}
                            </Button>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {t("adm_receipt_status")}: {d.deliveries[p.id]?.receipt_status ?? "\u2014"}
                            {", "}
                            {t("adm_notif_status")}: {d.deliveries[p.id]?.notification_status ?? "\u2014"}
                          </span>
                        </>
                      )}
                      {p.status === "submitted" && (
                        <>
                          <Button
                            size="sm"
                            disabled={d.busy}
                            onClick={() => d.decidePayment(p.id, "verified", notes[p.id] ?? null)}
                          >
                            {t("mark_verified")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={d.busy}
                            onClick={() => d.decidePayment(p.id, "rejected", notes[p.id] ?? null)}
                          >
                            {t("reject")}
                          </Button>
                          <Input
                            className="h-9 max-w-[12rem]"
                            placeholder={t("admin_notes")}
                            value={notes[p.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </SectionCard>
    </AdminShell>
  );
}

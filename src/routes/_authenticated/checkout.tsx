import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2, Clock, XCircle, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadToR2 } from "@/lib/upload";
import { friendlyUploadError } from "@/lib/compress";
import { createViewUrl } from "@/lib/storage.functions";
import { submitManualPayment, getBankTransferDetails, PRICES } from "@/lib/payments.functions";
import { notifyPaymentSubmitted } from "@/lib/notify.functions";

export const Route = createFileRoute("/_authenticated/checkout")({
  head: () => ({
    meta: [
      { title: "Payments — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content:
          "Activate the Standard or Premium plan, or order the Jathagam report, by UPI or Direct Bank Transfer.",
      },
      { property: "og:title", content: "Payments — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Activate your membership plan." },
    ],
  }),
  component: Checkout,
});

type Item = "standard" | "premium" | "jathagam";

type PaymentRow = {
  id: string;
  item: Item;
  amount_inr: number;
  method: string;
  utr_reference: string | null;
  status: "submitted" | "verified" | "rejected";
  admin_notes: string | null;
  created_at: string;
};

type JathagamRow = {
  id: string;
  birth_date: string;
  birth_time: string;
  birth_place: string;
  status: string;
  report_key: string | null;
};

// UPI details shown for the manual transfer route.
const UPI_ID = "7639150271@pnb";
const UPI_QR_PATH = "/payment/pnb-upi-qr.jpeg";

function Checkout() {
  const { t } = useI18n();
  const [userId, setUserId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Member");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [delivery, setDelivery] = useState<Map<string, { receipt_key: string | null; receipt_status: string | null }>>(new Map());
  const [jathagam, setJathagam] = useState<JathagamRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [manualFor, setManualFor] = useState<Item | null>("standard");
  const [utr, setUtr] = useState("");
  const [method, setMethod] = useState<"upi" | "bank_transfer">("upi");
  const [proof, setProof] = useState<File | null>(null);
  const [birth, setBirth] = useState({ date: "", time: "", place: "" });
  const [bankDetails, setBankDetails] = useState<{
    beneficiary: string;
    accountNumber: string;
    ifsc: string;
    micr: string | null;
    mobile: string | null;
    amount: number;
  } | null>(null);
  const [loadingBankDetails, setLoadingBankDetails] = useState(false);

  const load = useCallback(async (uid: string) => {
    const [{ data: pays }, { data: jats }, { data: profile }, evRows] = await Promise.all([
      supabase
        .from("payments")
        .select("id, item, amount_inr, method, utr_reference, status, admin_notes, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("jathagam_requests")
        .select("id, birth_date, birth_time, birth_place, status, report_key")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
      ((supabase as unknown as {
        from(table: string): unknown;
      }).from("payment_events") as unknown as {
        select(
          cols: string,
        ): Promise<{
          data: Array<{ payment_id: string; receipt_key: string | null; receipt_status: string | null }> | null;
        }>;
      }).select("payment_id, receipt_key, receipt_status"),
    ]);
    setPayments((pays ?? []) as PaymentRow[]);
    setJathagam((jats ?? []) as JathagamRow[]);
    setDelivery(new Map((evRows?.data ?? []).map((e) => [e.payment_id, e])));
    if (profile?.full_name) setFullName(profile.full_name);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      void load(data.user.id);
    });
  }, [load]);

  async function fetchBankDetails(item: Item) {
    setLoadingBankDetails(true);
    try {
      const details = await getBankTransferDetails({ data: { item } });
      setBankDetails(details);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load bank details");
      setBankDetails(null);
    } finally {
      setLoadingBankDetails(false);
    }
  }

  async function submitManual(item: Item) {
    if (!userId) return;
    if (!utr.trim()) {
      toast.error(t("utr_required"));
      return;
    }
    if (item === "jathagam" && (!birth.date || !birth.time || !birth.place)) {
      toast.error(t("checkout_birth_required"));
      return;
    }
    setBusy(true);
    try {
      let proofKey: string | null = null;
      if (proof) {
        const up = await uploadToR2(proof, "payment_proof");
        proofKey = up.key;
      }
      const { paymentId } = await submitManualPayment({
        data: { item, method, utrReference: utr.trim(), proofKey },
      });

      if (item === "jathagam") {
        await supabase.from("jathagam_requests").insert({
          user_id: userId,
          payment_id: paymentId,
          birth_date: birth.date,
          birth_time: birth.time,
          birth_place: birth.place,
        });
      }

      await notifyPaymentSubmitted({
        data: { item, amount: PRICES[item], reference: utr.trim(), fullName },
      });

      toast.success(t("payment_submitted"));
      setManualFor(null);
      setUtr("");
      setProof(null);
      setBankDetails(null);
      await load(userId);
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function openReport(key: string) {
    try {
      const { url } = await createViewUrl({ data: { key } });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("msg_open_report_fail"));
    }
  }

  const items: { item: Item; name: string; price: number; note: string }[] = [
    { item: "standard", name: t("plan_std"), price: PRICES.standard, note: t("plan_std_d") },
    { item: "premium", name: t("plan_prem"), price: PRICES.premium, note: t("plan_prem_d") },
    { item: "jathagam", name: t("jathagam"), price: PRICES.jathagam, note: t("jathagam_d") },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="font-display text-3xl font-semibold">{t("checkout_title")}</h1>
        <div className="gold-rule mt-3 w-24" />
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{t("checkout_sub")}</p>

        <div className="mt-8 space-y-5">
          {items.map((p) => (
            <div key={p.item} className="card-elevated p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold">{p.name}</h2>
                  <p className="mt-1 max-w-lg text-sm text-muted-foreground">{p.note}</p>
                </div>
                <p className="font-display text-2xl font-semibold text-primary">
                  ₹{p.price.toLocaleString("en-IN")}
                </p>
              </div>

              {p.item === "jathagam" && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="bdate">{t("dob")}</Label>
                    <Input
                      id="bdate"
                      type="date"
                      value={birth.date}
                      onChange={(e) => setBirth((b) => ({ ...b, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="btime">{t("birth_time")}</Label>
                    <Input
                      id="btime"
                      type="time"
                      value={birth.time}
                      onChange={(e) => setBirth((b) => ({ ...b, time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bplace">{t("birth_place")}</Label>
                    <Input
                      id="bplace"
                      value={birth.place}
                      onChange={(e) => setBirth((b) => ({ ...b, place: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              <div className="mt-4">
                <Button
                  disabled={busy}
                  onClick={() => {
                    const next = manualFor === p.item ? null : p.item;
                    setManualFor(next);
                    if (next) {
                      setMethod("upi");
                      setBankDetails(null);
                    }
                  }}
                >
                  {t("pay_manual")}
                </Button>
              </div>

              {manualFor === p.item && (
                <div className="mt-4 space-y-3 rounded-lg border border-border bg-secondary/40 p-4">
                  {method === "upi" ? (
                    <>
                      <p className="text-sm">
                        UPI: <span className="font-semibold">{UPI_ID}</span> — ₹
                        {p.price.toLocaleString("en-IN")}
                      </p>
                      <div className="text-center">
                        <img
                          src={UPI_QR_PATH}
                          alt="UPI QR Code"
                          className="mx-auto max-w-xs h-auto border border-border rounded"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      {loadingBankDetails ? (
                        <p className="text-sm text-muted-foreground">Loading bank details…</p>
                      ) : bankDetails ? (
                        <div className="space-y-2 text-sm">
                          <p>
                            <span className="font-semibold">{t("bank_beneficiary")}:</span>{" "}
                            {bankDetails.beneficiary}
                          </p>
                          <p>
                            <span className="font-semibold">{t("bank_account")}:</span>{" "}
                            {bankDetails.accountNumber}
                          </p>
                          <p>
                            <span className="font-semibold">{t("bank_ifsc")}:</span> {bankDetails.ifsc}
                          </p>
                          {bankDetails.micr && (
                            <p>
                              <span className="font-semibold">{t("bank_micr")}:</span>{" "}
                              {bankDetails.micr}
                            </p>
                          )}
                          {bankDetails.mobile && (
                            <p>
                              <span className="font-semibold">{t("bank_mobile")}:</span>{" "}
                              {bankDetails.mobile}
                            </p>
                          )}
                          <p className="font-semibold">
                            {t("payable_amount")}: ₹{bankDetails.amount.toLocaleString("en-IN")}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-destructive">
                          {t("bank_details_unavailable")}
                        </p>
                      )}
                    </>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="utr">{t("utr")}</Label>
                      <Input id="utr" value={utr} onChange={(e) => setUtr(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="method">{t("payment_method")}</Label>
                      <select
                        id="method"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={method}
                        onChange={(e) => {
                          const newMethod = e.target.value as "upi" | "bank_transfer";
                          setMethod(newMethod);
                          if (newMethod === "bank_transfer") {
                            fetchBankDetails(p.item);
                          }
                        }}
                      >
                        <option value="upi">{t("method_upi")}</option>
                        <option value="bank_transfer">{t("method_bank_transfer")}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="proof">{t("payment_proof")}</Label>
                    <Input
                      id="proof"
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button disabled={busy} onClick={() => submitManual(p.item)}>
                    {t("submit_payment")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <h2 className="mt-12 font-display text-2xl font-semibold">{t("my_payments")}</h2>
        <div className="mt-4 space-y-3">
          {payments.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
          {payments.map((p) => (
            <div key={p.id} className="card-elevated flex flex-wrap items-center gap-3 p-4 text-sm">
              {p.status === "verified" ? (
                <CheckCircle2 className="size-5 text-success" />
              ) : p.status === "rejected" ? (
                <XCircle className="size-5 text-destructive" />
              ) : (
                <Clock className="size-5 text-warning" />
              )}
              <span className="font-medium capitalize">{p.item}</span>
              <span>₹{p.amount_inr.toLocaleString("en-IN")}</span>
              <span className="text-muted-foreground">{p.method}</span>
              {p.utr_reference && (
                <span className="text-muted-foreground">UTR {p.utr_reference}</span>
              )}
              <span className="ml-auto capitalize">{p.status}</span>
              {p.admin_notes && (
                <span className="w-full text-xs text-muted-foreground">{p.admin_notes}</span>
              )}
              {p.status === "verified" &&
                (delivery.get(p.id)?.receipt_key ? (
                  <>
                    <span className="text-xs text-success">{t("receipt_available")}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openReport(delivery.get(p.id)!.receipt_key!)}
                    >
                      <Download className="mr-1 size-4" />
                      {t("download_receipt")}
                    </Button>
                  </>
                ) : delivery.get(p.id)?.receipt_status === "failed" ? null : (
                  <span className="text-xs text-muted-foreground">{t("receipt_pending")}</span>
                ))}
            </div>
          ))}
        </div>

        {jathagam.length > 0 && (
          <>
            <h2 className="mt-12 font-display text-2xl font-semibold">{t("jathagam")}</h2>
            <div className="mt-4 space-y-3">
              {jathagam.map((j) => (
                <div
                  key={j.id}
                  className="card-elevated flex flex-wrap items-center gap-3 p-4 text-sm"
                >
                  <span>
                    {j.birth_date} · {j.birth_time} · {j.birth_place}
                  </span>
                  <span className="ml-auto capitalize">{j.status}</span>
                  {j.report_key && (
                    <Button size="sm" variant="secondary" onClick={() => openReport(j.report_key!)}>
                      <Download className="mr-1 size-4" />
                      {t("download_report")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

// Berichte's XLSX export (S4-05-reports.md: "the only genuinely new UI capability in this boot").
// Kept client-side and in its own module, like `lib/csv.ts`'s CSV writer: the RPC data is already in
// the browser, the anon key reaches nothing the viewer could not already see, and this app has no
// server-side route pattern to add one for. Isolated from lib/reports.ts so unit tests covering the
// pure aggregation logic never have to load `exceljs`.
import ExcelJS from "exceljs";
import type { PeriodRange } from "@/lib/reports";
import type { DeliveryTimeRow, FunnelRow, PaymentReportRow, RevenueByDayRow, TopItemRow } from "@/lib/types";

const EUR_FMT = '#,##0.00 "€"';
const cents = (c: number | null | undefined) => Math.round((c ?? 0)) / 100;

function headerRow(sheet: ExcelJS.Worksheet, title: string, range: PeriodRange, cols: number) {
  // "a header row with the window stated in the sheet itself (not only in the filename) — an
  // exported figure that does not carry its own date range is a figure someone will misread in
  // three months."
  const r = sheet.addRow([`${title} · ${range.from} – ${range.to} (Europe/Berlin, both ends inclusive)`]);
  r.font = { bold: true };
  sheet.mergeCells(r.number, 1, r.number, Math.max(cols, 2));
  sheet.addRow([]);
}

function tableHeader(sheet: ExcelJS.Worksheet, labels: string[]) {
  const r = sheet.addRow(labels);
  r.font = { bold: true };
  r.eachCell((c) => (c.border = { bottom: { style: "thin" } }));
}

function moneyCols(sheet: ExcelJS.Worksheet, startRow: number, cols: number[]) {
  for (let row = startRow; row <= sheet.rowCount; row++) {
    for (const col of cols) sheet.getCell(row, col).numFmt = EUR_FMT;
  }
}

export type ReportsExportInput = {
  range: PeriodRange;
  revenueByDay: RevenueByDayRow[];
  topItems: TopItemRow[];
  funnel: FunnelRow | null;
  deliveryTimes: DeliveryTimeRow[];
  /** null = report_payments was refused for this role (§8.5); the sheet says so rather than lying empty. */
  payments: PaymentReportRow[] | null;
  labels: {
    revenue: string; topItems: string; deliveryTimes: string; payments: string; funnel: string;
    paymentsForbidden: string; noDataYet: string; notCollected: string; notRecordedYet: string;
  };
};

export async function buildReportsWorkbook(input: ReportsExportInput): Promise<ExcelJS.Workbook> {
  const { range } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SHOSHO Back-office";
  wb.created = new Date();

  // --- Revenue by day --------------------------------------------------------------------------
  const rev = wb.addWorksheet(input.labels.revenue.slice(0, 31));
  headerRow(rev, input.labels.revenue, range, 13);
  tableHeader(rev, ["Tag", "Bestellungen", "Umsatz", "Lieferung", "Abholung", "Zusatzverkauf", "Liefergebühr", "Trinkgeld", "Rabatt", "MwSt.", "⌀ Bon", "Storniert", "Erstattet"]);
  const revStart = rev.rowCount + 1;
  for (const r of input.revenueByDay) {
    rev.addRow([r.day, r.orders_count, cents(r.revenue_cents), cents(r.delivery_revenue_cents), cents(r.pickup_revenue_cents), cents(r.upsell_cents), cents(r.delivery_fee_cents), cents(r.tip_cents), cents(r.discount_cents), cents(r.vat_cents), cents(r.avg_basket_cents), r.cancelled_count, cents(r.refunded_cents)]);
  }
  moneyCols(rev, revStart, [3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
  rev.columns.forEach((c) => (c.width = 14));

  // --- Top items ---------------------------------------------------------------------------------
  const top = wb.addWorksheet(input.labels.topItems.slice(0, 31));
  headerRow(top, input.labels.topItems, range, 8);
  tableHeader(top, ["SKU", "Artikel", "Menge", "Bestellungen", "Umsatz", "Kosten", "Marge", "Anteil %"]);
  const topStart = top.rowCount + 1;
  for (const r of input.topItems) {
    top.addRow([r.sku, r.name_de || r.name, r.qty, r.orders_count, cents(r.revenue_cents), r.cost_cents == null ? null : cents(r.cost_cents), cents(r.margin_cents), r.share_pct]);
  }
  moneyCols(top, topStart, [5, 6, 7]);
  for (let row = topStart; row <= top.rowCount; row++) top.getCell(row, 8).numFmt = "0.0 %";
  top.columns.forEach((c) => (c.width = 14));

  // --- Delivery times ------------------------------------------------------------------------------
  const dt = wb.addWorksheet(input.labels.deliveryTimes.slice(0, 31));
  headerRow(dt, input.labels.deliveryTimes, range, 7);
  tableHeader(dt, ["Zone", "Bestellungen", "⌀ Ist (Min.)", "⌀ Versprochen (Min.)", "Δ (Min.)", "Überfällig", "Überfällig %"]);
  const dtStart = dt.rowCount + 1;
  for (const r of input.deliveryTimes) {
    dt.addRow([r.zone_id == null ? "Abholung" : r.zone_name, r.orders_count, r.avg_actual_minutes, r.avg_promised_minutes, r.delta_minutes, r.overdue_count, r.overdue_share_pct]);
  }
  for (let row = dtStart; row <= dt.rowCount; row++) dt.getCell(row, 7).numFmt = "0.0 %";
  dt.columns.forEach((c) => (c.width = 16));

  // --- Payments (§8.5 — owner/operator only; may be refused for the exporting role) --------------
  const pay = wb.addWorksheet(input.labels.payments.slice(0, 31));
  headerRow(pay, input.labels.payments, range, 6);
  if (input.payments === null) {
    pay.addRow([input.labels.paymentsForbidden]);
  } else {
    tableHeader(pay, ["Zahlungsart", "Status", "Bestellungen", "Betrag", "Erstattet", "Fehlgeschlagene Jobs"]);
    const payStart = pay.rowCount + 1;
    const allZero = input.payments.length === 0 || input.payments.every((r) => r.orders_count === 0 && r.total_cents === 0 && r.refunded_cents === 0 && r.failed_jobs_count === 0);
    if (allZero) {
      pay.addRow([input.labels.noDataYet]);
    } else {
      for (const r of input.payments) pay.addRow([r.payment_method, r.payment_status, r.orders_count, cents(r.total_cents), cents(r.refunded_cents), r.failed_jobs_count]);
      moneyCols(pay, payStart, [4, 5]);
    }
  }
  pay.columns.forEach((c) => (c.width = 16));

  // --- Funnel (D-015 / §6.9 row 5 — two honest gaps stated, not hidden) ---------------------------
  const fn = wb.addWorksheet(input.labels.funnel.slice(0, 31));
  headerRow(fn, input.labels.funnel, range, 2);
  const row = (label: string, value: string | number) => fn.addRow([label, value]);
  row("MENÜ → WARENKORB", input.labels.notCollected);
  if (input.funnel && input.funnel.attempts_window_from != null) {
    const w = `${input.funnel.attempts_window_from} – ${input.funnel.attempts_window_to}`;
    row("Anfragen (Fenster)", w);
    row("Anfragen", input.funnel.attempts);
    row("Anfragen mit Problemen", input.funnel.attempts_with_problems);
    row("Anfragen → Bestellt %", input.funnel.attempts_to_placed_pct);
  } else {
    row("ANFRAGEN → BESTELLT", input.labels.notRecordedYet);
  }
  row("Bestellt", input.funnel?.placed ?? 0);
  row("Bezahlt", input.funnel?.paid ?? 0);
  row("Bestellt → Bezahlt %", input.funnel?.placed_to_paid_pct ?? 0);
  row("Storniert", input.funnel?.cancelled ?? 0);
  row("Zusatzverkauf · Bestellungen", input.funnel?.upsell_orders ?? 0);
  row("Zusatzverkauf · Betrag", cents(input.funnel?.upsell_cents ?? 0));
  fn.getColumn(1).font = { bold: true };
  fn.columns.forEach((c) => (c.width = 28));

  return wb;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportReportsXlsx(input: ReportsExportInput): Promise<void> {
  const wb = await buildReportsWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(`shosho-berichte-${input.range.from}_${input.range.to}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

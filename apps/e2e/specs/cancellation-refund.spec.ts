import type { Page } from "@playwright/test";
import { dismissCookieBanner, expect, test } from "../fixtures";
import { freshPhone, openAllDayAndResume, POSTAL } from "../helpers/db";

test.beforeAll(openAllDayAndResume);

async function placeDeliveryOrder(webPage: Page, name: string) {
  const phone = freshPhone();
  await webPage.goto("/");
  await dismissCookieBanner(webPage);
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.goto("/checkout");
  await webPage.getByPlaceholder("Street and number").fill("Kastanienallee 1");
  await webPage.getByPlaceholder("10119").fill(POSTAL.zoneB);
  await webPage.getByPlaceholder("Your name").fill(name);
  await webPage.getByPlaceholder("+49 30 000 000").fill(phone);
  await webPage.getByRole("radio", { name: "Cash on delivery" }).click();
  await webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ }).click();
  await expect(webPage).toHaveURL(/\/order\/[0-9a-f]{32}$/);
  return new URL(webPage.url()).pathname.split("/").pop()!;
}

test("operator cancels a new order with a reason; the guest's tracking page shows it as cancelled", async ({ webPage, boPage, db, signInBackoffice }) => {
  const token = await placeDeliveryOrder(webPage, "E2E Cancel Guest");
  const { data: order } = await db.from("orders").select("id, number").eq("tracking_token", token).single();

  await signInBackoffice(boPage, "operator");
  await boPage.goto(`/orders/${order!.id}`);
  await boPage.getByRole("button", { name: /Ablehnen/ }).click();
  const dialog = boPage.getByRole("dialog");
  await dialog.getByRole("combobox").selectOption({ label: "Kunde hat storniert" });
  await dialog.getByRole("button", { name: "Stornieren" }).click();
  await expect(boPage.getByText("STORNIERT")).toBeVisible();

  const { data: after } = await db.from("orders").select("status, cancel_reason").eq("id", order!.id).single();
  expect(after!.status).toBe("cancelled");
  // CancelDialog.tsx sends `reason: t(reason)` — the *translated label in the UI's current language*,
  // not a stable code. An operator who cancels in DE writes a German sentence into a column every other
  // surface (CSV export, reports, an EN-toggled detail view) will render verbatim, in German, forever.
  expect(after!.cancel_reason, "cancel_reason is operator-facing free text keyed to the UI language at click time, not a stable code — see note in this test").toBe("Kunde hat storniert");

  await webPage.goto(`/order/${token}`);
  await expect(webPage.getByText("Cancelled")).toBeVisible();
});

test("owner refunds a paid, completed order", async ({ webPage, boPage, db, signInBackoffice }) => {
  const token = await placeDeliveryOrder(webPage, "E2E Refund Guest");
  const { data: order } = await db.from("orders").select("id, number").eq("tracking_token", token).single();

  // Drive it to delivered via the real driver flow (checkout-delivery.spec.ts's pattern) so
  // payment_status is genuinely 'paid' before attempting a refund — not faked with a direct write.
  await signInBackoffice(boPage, "operator");
  await boPage.goto(`/orders/${order!.id}`);
  await boPage.getByRole("button", { name: /Annehmen/ }).click();
  await boPage.getByRole("button", { name: "Zubereitung starten" }).click();
  await boPage.getByRole("button", { name: "Fertig melden" }).click();
  await boPage.getByRole("button", { name: "An Fahrer übergeben" }).click();
  await boPage.getByRole("radio", { name: /Jonas M\./ }).click();
  await boPage.getByRole("button", { name: /Übergeben/ }).click();

  await boPage.getByRole("button", { name: "Abmelden" }).click();
  await signInBackoffice(boPage, "driver");
  await expect(boPage).toHaveURL(/\/driver$/);
  await boPage.getByRole("button", { name: /Zugestellt/ }).click();

  await boPage.getByRole("button", { name: "Abmelden" }).click();
  await signInBackoffice(boPage, "owner");
  await boPage.goto(`/orders/${order!.id}`);
  await expect(boPage.getByText("ZUGESTELLT")).toBeVisible();
  await boPage.getByRole("button", { name: "Erstatten" }).click();
  await boPage.getByRole("dialog").getByRole("button", { name: "Erstatten" }).click();
  await expect(boPage.getByText("ERSTATTET")).toBeVisible();

  const { data: after } = await db.from("orders").select("status, payment_status, payment_refunded_cents, total_cents").eq("id", order!.id).single();
  expect(after!.status).toBe("refunded");
  expect(after!.payment_status).toBe("refunded");
  expect(after!.payment_refunded_cents, "full refund, no provider on this order (v1 client-reported, no Stripe keys on this stack)").toBe(after!.total_cents);
});

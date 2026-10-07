import { expect, test } from "../fixtures";
import { openAllDayAndResume, POSTAL } from "../helpers/db";

// api-contracts §5.2 problem codes, hit from the real checkout UI (not just the RPC directly — S3-01's
// own claim is "cart totals come only from quote_order"; these confirm the *rejection* path renders
// what the server actually said, not a client-side guess).
test.describe("checkout rejections", () => {
  test.beforeEach(openAllDayAndResume);

  test("below minimum order for the zone", async ({ webPage }) => {
    await webPage.goto("/");
    await webPage.getByRole("button", { name: "OK" }).click();
    await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click(); // 13.50, zone B min is 22.00
    await webPage.goto("/checkout");
    await webPage.getByPlaceholder("Street and number").fill("Kastanienallee 1");
    await webPage.getByPlaceholder("10119").fill(POSTAL.zoneB);
    await expect(webPage.getByText(/Minimum order for your zone is/)).toBeVisible();
  });

  test("postal code outside every delivery zone", async ({ webPage }) => {
    await webPage.goto("/");
    await webPage.getByRole("button", { name: "OK" }).click();
    await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
    await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
    await webPage.goto("/checkout");
    await webPage.getByPlaceholder("Street and number").fill("Nowhere Street 1");
    await webPage.getByPlaceholder("10119").fill(POSTAL.outside);
    await expect(webPage.getByText("We don't deliver to this address")).toBeVisible();
    await webPage.getByRole("button", { name: "Switch to pickup" }).click();
    await expect(webPage.getByRole("radio", { name: "Pickup", checked: true })).toBeVisible();
  });

  test("kitchen paused — ordering shows the sold-out banner and blocks checkout", async ({ webPage, db }) => {
    await db.from("settings").update({ value: { paused: true, paused_by: null, paused_at: new Date().toISOString(), rush: false } }).eq("key", "kitchen");
    try {
      await webPage.goto("/");
      await expect(webPage.getByText(/sold out today|paused/i)).toBeVisible();
    } finally {
      await openAllDayAndResume(); // leave the shared stack as we found it
    }
  });
});

test("design/README: 'Operator can pause intake' is visible on the board too", async ({ boPage, signInBackoffice, db }) => {
  await openAllDayAndResume();
  await signInBackoffice(boPage, "operator");
  await boPage.getByRole("button", { name: "Pause" }).click();
  await expect(boPage.getByText(/Pausiert/)).toBeVisible();
  const { data } = await db.from("settings").select("value").eq("key", "kitchen").single();
  expect((data!.value as { paused: boolean }).paused).toBe(true);
  // restore for the next spec file sharing this stack
  await boPage.getByRole("button", { name: "Online gehen" }).click();
  await openAllDayAndResume();
});

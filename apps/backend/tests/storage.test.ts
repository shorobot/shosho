import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, signIn } from "./helpers";

beforeAll(openAllDay);
// storage.objects may only exist after the storage container has run its own migrations
beforeAll(async () => {
  await admin().rpc("ensure_menu_bucket_policies");
});

const ITEM_ID = "30000000-0000-4000-8000-000000000001"; // Philadelphia Roll (seed)
const png = () =>
  // 1×1 transparent PNG
  Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

describe("storage bucket `menu`", () => {
  it("exists, is public, and lets anyone read", async () => {
    const { data: bucket, error } = await admin().storage.getBucket("menu");
    expect(error).toBeNull();
    expect(bucket!.public).toBe(true);
    const { data: list, error: lsErr } = await anon().storage.from("menu").list();
    expect(lsErr).toBeNull();
    expect(Array.isArray(list)).toBe(true);
  });

  it("operator and owner upload / overwrite / delete; anon and kitchen cannot", async () => {
    const [operator, owner, kitchen] = await Promise.all([signIn("operator"), signIn("owner"), signIn("kitchen")]);
    const path = `${ITEM_ID}/${Date.now()}.jpg`;
    const body = png();
    const opts = { contentType: "image/png", upsert: true };

    const { error: anonUp } = await anon().storage.from("menu").upload(`${ITEM_ID}/anon.jpg`, body, opts);
    expect(anonUp).not.toBeNull();
    const { error: kitchenUp } = await kitchen.storage.from("menu").upload(`${ITEM_ID}/kitchen.jpg`, body, opts);
    expect(kitchenUp).not.toBeNull();

    const { error: opUp } = await operator.storage.from("menu").upload(path, body, opts);
    expect(opUp).toBeNull();
    const { error: overwrite } = await owner.storage.from("menu").upload(path, body, opts);
    expect(overwrite).toBeNull();

    // public read: anon downloads it and the public URL is bucket-qualified as §1.2 expects
    const { data: dl, error: dlErr } = await anon().storage.from("menu").download(path);
    expect(dlErr).toBeNull();
    expect(dl!.size).toBeGreaterThan(0);
    const { data: pub } = anon().storage.from("menu").getPublicUrl(path);
    expect(pub.publicUrl).toContain(`/storage/v1/object/public/menu/${path}`);

    // storage `remove` answers 200 with an empty list when RLS filters the row — the file survives
    const { data: anonDel } = await anon().storage.from("menu").remove([path]);
    expect(anonDel ?? []).toEqual([]);
    expect((await anon().storage.from("menu").download(path)).error).toBeNull(); // still there
    const { error: opDel } = await operator.storage.from("menu").remove([path]);
    expect(opDel).toBeNull();
  });

  it("menu_items.photos stores bucket-qualified paths the operator can write", async () => {
    const operator = await signIn("operator");
    const path = `menu/${ITEM_ID}/1.jpg`;
    const { error } = await operator.from("menu_items").update({ photos: [path] }).eq("id", ITEM_ID);
    expect(error).toBeNull();
    const { data } = await anon().from("menu_items").select("photos").eq("id", ITEM_ID).single();
    expect(data!.photos).toEqual([path]);
    await admin().from("menu_items").update({ photos: [] }).eq("id", ITEM_ID);
  });
});

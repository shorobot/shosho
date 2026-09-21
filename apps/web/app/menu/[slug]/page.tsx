import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductClient } from "@/components/product/ProductClient";
import { getCatalog } from "@/lib/catalog";
import { findItemBySlug } from "@/lib/slug";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { items } = await getCatalog();
  const item = findItemBySlug(items, slug);
  if (!item) return { title: "Not found" };
  return { title: item.name_en, description: item.description_en ?? undefined };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const catalog = await getCatalog();
  const item = findItemBySlug(catalog.items, slug);
  if (!item) notFound();
  const category = catalog.categories.find((c) => c.id === item.category_id) ?? null;
  const recommended = item.recommended_item_ids.map((id) => catalog.items.find((i) => i.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  return <ProductClient item={item} category={category} recommended={recommended} />;
}

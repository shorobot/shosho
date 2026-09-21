import { getCatalog, visibleCategories } from "@/lib/catalog";
import { HomeClient } from "@/components/home/HomeClient";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const [catalog, params] = await Promise.all([getCatalog(), searchParams]);
  const categories = visibleCategories(catalog);
  return <HomeClient categories={categories} initialQuery={params.q ?? ""} initialCategory={params.c ?? ""} />;
}

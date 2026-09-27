import { ItemEditor } from "@/components/menu/ItemEditor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemEditor itemId={id} />;
}

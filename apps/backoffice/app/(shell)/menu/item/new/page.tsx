"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ItemEditor } from "@/components/menu/ItemEditor";

// "+ Artikel anlegen" from an empty category arrives with ?category=<id> so the new item starts in
// the category the operator was looking at.
function New() {
  const category = useSearchParams().get("category");
  return <ItemEditor itemId={null} presetCategoryId={category} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <New />
    </Suspense>
  );
}

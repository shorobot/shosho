import { EmptyState } from "@/components/ui/EmptyState";
import { PillLink } from "@/components/ui/Pill";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[520px] px-4 py-16">
      <EmptyState icon="⌕" title="This page doesn't exist" body="The link may be old or mistyped. The menu is one tap away." action={<PillLink href="/" size="sm">Open the menu</PillLink>} />
    </div>
  );
}

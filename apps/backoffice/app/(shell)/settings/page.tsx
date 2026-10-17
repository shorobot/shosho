import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsProvider } from "@/lib/settingsStore";
import { requireRole } from "@/lib/auth";

// BO · Einstellungen. The gate is the route's own, not just RLS: `settings` is owner-write
// (`settings_owner_write`), so an operator session is admitted read-only by this page but a kitchen
// or driver session never reaches it at all — S4-03 found a write a policy does not admit comes back
// `[]` with no error, so the route guard is what actually holds for the roles this screen must not
// show payment data to.
export default async function Page() {
  const { staff } = await requireRole(["owner", "operator"]);
  return (
    <SettingsProvider me={staff}>
      <SettingsScreen />
    </SettingsProvider>
  );
}

import { AutomationScreen } from "@/components/automation/AutomationScreen";
import { AutomationProvider } from "@/lib/automationStore";
import { requireRole } from "@/lib/auth";

// BO · Automation. Owner/operator only — every table here (agent_tasks/runs/run_logs/outputs) is
// owner/operator read-only RLS with no kitchen/driver policy at all (api-contracts §8.8), and
// review_agent_output() refuses non-owner/operator with 42501. The route guard is the thing that
// actually keeps kitchen/driver out before either of those ever fires (S4-03's finding, same reason
// /reports and /website carry their own requireRole rather than relying on RLS alone).
export default async function Page() {
  const { staff } = await requireRole(["owner", "operator"]);
  return (
    <AutomationProvider me={staff}>
      <AutomationScreen />
    </AutomationProvider>
  );
}

import { LoginForm } from "@/components/shell/LoginForm";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Anmelden" };

export default function LoginPage() {
  return <LoginForm configured={isSupabaseConfigured()} />;
}

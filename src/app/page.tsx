import { redirect } from "next/navigation";
import { requireOperatorSession } from "@/lib/auth/guard";
import Dashboard from "@/components/dashboard";

export const instant = false;

export default async function Home() {
  const auth = await requireOperatorSession();

  if (!auth.authenticated) {
    redirect("/login");
  }

  return <Dashboard operatorUsername={auth.operator.username} />;
}

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOperatorSession } from "@/lib/auth/guard";
import LoginForm from "@/components/login-form";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign In — Uptime Atlas",
  description: "Operator login for Uptime Atlas monitoring dashboard.",
};

export default async function LoginPage() {
  const auth = await requireOperatorSession();

  // If the operator already has a valid active session, redirect to the dashboard
  if (auth.authenticated) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <LoginForm />
    </main>
  );
}

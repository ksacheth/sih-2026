import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OnboardingClient } from "@/components/dashboard/onboarding-client";

export default async function OnboardingPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  return <OnboardingClient />;
}

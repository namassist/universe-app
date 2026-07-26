import { redirect } from "next/navigation";

import { serverApi } from "@/lib/api";

/**
 * The index used to be an open role switcher — pick a role, get its view of the
 * product. That cannot survive real authorization: a role is now a database row
 * resolved from the session, not something a visitor selects.
 */
export default async function Home() {
  const api = await serverApi();
  const { data, error } = await api.v1.auth.session.get();
  if (error || !data || data.principal.kind !== "user") redirect("/login");
  if (data.principal.mustChangePassword) redirect("/change-password");
  redirect("/dashboard");
}

import { LeaderboardBreakdown } from "@/components/menus/leaderboard-breakdown";

export const metadata = { title: "Rincian Poin" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { employeeId } = await params;
  return (
    <LeaderboardBreakdown employeeId={employeeId} search={await searchParams} />
  );
}

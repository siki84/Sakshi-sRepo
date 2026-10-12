import { notFound } from "next/navigation";
import { getTrip } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) notFound();
  return <div className="space-y-4">{children}</div>;
}

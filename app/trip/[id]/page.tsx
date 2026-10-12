import { redirect } from "next/navigation";

export default async function TripIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/trip/${id}/destination`);
}

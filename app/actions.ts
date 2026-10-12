"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTrip, deleteTrip } from "@/lib/repo";

export async function newTripAction() {
  const trip = createTrip();
  redirect(`/trip/${trip.id}/destination`);
}

export async function deleteTripAction(formData: FormData) {
  deleteTrip(String(formData.get("id")));
  revalidatePath("/");
}

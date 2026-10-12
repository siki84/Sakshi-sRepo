import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** E2E-only: wipe user data between tests. Disabled unless E2E=1. */
export async function POST() {
  if (process.env.E2E !== "1") return new Response("Not found", { status: 404 });
  db().exec("DELETE FROM trips; DELETE FROM profile;");
  return Response.json({ ok: true });
}

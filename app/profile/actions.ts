"use server";

import { revalidatePath } from "next/cache";
import { ProfileSchema } from "@/lib/schemas";
import { saveProfile } from "@/lib/repo";

export type SaveProfileResult = { ok: true } | { ok: false; errors: Record<string, string> };

export async function saveProfileAction(input: unknown): Promise<SaveProfileResult> {
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      errors[key] ??= issue.message;
    }
    return { ok: false, errors };
  }
  saveProfile(parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

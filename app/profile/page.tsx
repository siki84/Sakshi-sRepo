import { getProfile } from "@/lib/repo";
import { ProfileForm } from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const profile = getProfile();
  // Only allow in-app redirects.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Traveler profile</h1>
        <p className="text-sm text-slate-600">
          Filled in once and reused for every trip. Change it any time.
          {safeNext && " Save it to continue planning your trip."}
        </p>
      </div>
      <ProfileForm initial={profile} next={safeNext} />
    </div>
  );
}

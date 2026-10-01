import { DashboardHeader } from "@/components/dashboard-header";

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-subtle">
      <DashboardHeader />
      {children}
    </div>
  );
}

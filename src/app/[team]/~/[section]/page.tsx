"use client";

import { useParams } from "next/navigation";
import { ComingSoon, DashboardTabs } from "@/components/dashboard-header";

export default function TeamSectionPage() {
  const { section } = useParams<{ section: string }>();
  const title = section.charAt(0).toUpperCase() + section.slice(1);
  return (
    <>
      <DashboardTabs />
      <ComingSoon title={title} />
    </>
  );
}

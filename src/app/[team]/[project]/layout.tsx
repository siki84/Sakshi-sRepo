"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/lib/store";
import { DashboardTabs, NotFoundPanel } from "@/components/dashboard-header";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { team, project } = useParams<{ team: string; project: string }>();
  const { project: p } = useProject(team, project);

  return (
    <>
      <DashboardTabs />
      {p ? children : <NotFoundPanel what="Project" />}
    </>
  );
}

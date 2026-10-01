"use client";

import { useParams } from "next/navigation";
import { ComingSoon } from "@/components/dashboard-header";

export default function ProjectTabPage() {
  const { tab } = useParams<{ tab: string }>();
  const title = tab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return <ComingSoon title={title} />;
}

"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import clsx from "clsx";

const SECTIONS = [
  { label: "General", path: "" },
  { label: "Build and Deployment", path: "/build-and-deployment" },
  { label: "Domains", path: "/domains" },
  { label: "Environments", path: "/environments" },
  { label: "Environment Variables", path: "/environment-variables" },
  { label: "Git", path: "/git" },
  { label: "Integrations", path: "/integrations" },
  { label: "Deployment Protection", path: "/deployment-protection" },
  { label: "Functions", path: "/functions" },
  { label: "Data Cache", path: "/data-cache" },
  { label: "Cron Jobs", path: "/cron-jobs" },
  { label: "Security", path: "/security" },
  { label: "Advanced", path: "/advanced" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { team, project } = useParams<{ team: string; project: string }>();
  const pathname = usePathname();
  const base = `/${team}/${project}/settings`;

  return (
    <>
      <div className="border-b border-border bg-bg">
        <h1 className="mx-auto max-w-6xl px-4 py-10 text-3xl font-semibold tracking-tight sm:px-6">Project Settings</h1>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col [scrollbar-width:none]">
          {SECTIONS.map((s) => {
            const href = base + s.path;
            const active = pathname === href;
            return (
              <Link
                key={s.label}
                href={href}
                className={clsx(
                  "shrink-0 rounded-md px-3 py-2 text-sm",
                  active ? "bg-bg-muted font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}

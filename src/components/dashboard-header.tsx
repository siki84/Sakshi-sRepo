"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, ChevronsUpDown, LogOut, Moon, Plus, RotateCcw, Settings, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { CURRENT_USER } from "@/lib/seed";
import { Avatar, Logo, Menu, MenuItem } from "./ui";

const Slash = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 text-border-strong" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M16.88 3.549L7.12 20.451" />
  </svg>
);

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const set = (value: boolean) => {
    document.documentElement.classList.toggle("dark", value);
    try {
      localStorage.setItem("theme", value ? "dark" : "light");
    } catch {}
    setDark(value);
  };
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      Theme
      <div className="flex rounded-full border border-border p-0.5">
        <button aria-label="Light theme" onClick={() => set(false)} className={clsx("rounded-full p-1", !dark && "bg-bg-muted")}>
          <Sun className="h-3.5 w-3.5" />
        </button>
        <button aria-label="Dark theme" onClick={() => set(true)} className={clsx("rounded-full p-1", dark && "bg-bg-muted")}>
          <Moon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function DashboardHeader() {
  const { team: teamSlug, project: projectName } = useParams<{ team: string; project?: string }>();
  const { state, dispatch } = useStore();
  const router = useRouter();
  const team = state.teams.find((t) => t.slug === teamSlug);
  const projects = state.projects.filter((p) => p.teamSlug === teamSlug);

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-bg px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-1">
        <Link href="/" aria-label="Home" className="mr-1">
          <Logo className="h-[22px] w-[22px]" />
        </Link>
        <Slash />
        <Link href={`/${teamSlug}`} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-bg-muted">
          <Avatar name={team?.name ?? teamSlug} size={20} />
          <span className="truncate">{team?.name ?? teamSlug}</span>
          <span className="hidden rounded-full border border-border px-2 text-xs text-fg-muted sm:inline">{team?.plan ?? "Hobby"}</span>
        </Link>
        {projectName && (
          <>
            <Slash />
            <Menu
              align="left"
              trigger={(toggle) => (
                <button onClick={toggle} className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-bg-muted">
                  <span className="truncate">{projectName}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-fg-muted" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <p className="px-3 py-1.5 text-xs text-fg-muted">Projects</p>
                  {projects.map((p) => (
                    <MenuItem
                      key={p.id}
                      onClick={() => {
                        close();
                        router.push(`/${teamSlug}/${p.name}`);
                      }}
                    >
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.name === projectName && <Check className="h-4 w-4" />}
                    </MenuItem>
                  ))}
                  <div className="my-1 border-t border-border" />
                  <MenuItem
                    onClick={() => {
                      close();
                      router.push("/new");
                    }}
                  >
                    <Plus className="h-4 w-4" /> Create Project
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <a href="https://vercel.com/docs" target="_blank" rel="noreferrer" className="hidden rounded-md px-2 py-1 text-sm text-fg-muted hover:text-fg sm:block">
          Docs
        </a>
        <Menu
          trigger={(toggle) => (
            <button onClick={toggle} aria-label="Account menu">
              <Avatar name={CURRENT_USER} size={32} />
            </button>
          )}
        >
          {() => (
            <>
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{CURRENT_USER}</p>
                <p className="text-xs text-fg-muted">Hobby plan</p>
              </div>
              <div className="my-1 border-t border-border" />
              <MenuItem>
                <Settings className="h-4 w-4" /> Account Settings
              </MenuItem>
              <ThemeToggle />
              <MenuItem onClick={() => dispatch({ type: "reset" })}>
                <RotateCcw className="h-4 w-4" /> Reset demo data
              </MenuItem>
              <div className="my-1 border-t border-border" />
              <MenuItem onClick={() => router.push("/")}>
                <LogOut className="h-4 w-4" /> Log Out
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

const PROJECT_TABS = [
  { label: "Overview", path: "" },
  { label: "Deployments", path: "/deployments" },
  { label: "Analytics", path: "/analytics" },
  { label: "Speed Insights", path: "/speed-insights" },
  { label: "Logs", path: "/logs" },
  { label: "Observability", path: "/observability" },
  { label: "Firewall", path: "/firewall" },
  { label: "Storage", path: "/stores" },
  { label: "Settings", path: "/settings" },
];

const TEAM_TABS = [
  { label: "Overview", path: "" },
  { label: "Integrations", path: "/~/integrations" },
  { label: "Deployments", path: "/~/deployments" },
  { label: "Activity", path: "/~/activity" },
  { label: "Domains", path: "/~/domains" },
  { label: "Usage", path: "/~/usage" },
  { label: "Settings", path: "/~/settings" },
];

export function DashboardTabs() {
  const { team, project } = useParams<{ team: string; project?: string }>();
  const pathname = usePathname();
  const base = project ? `/${team}/${project}` : `/${team}`;
  const tabs = project ? PROJECT_TABS : TEAM_TABS;

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-bg">
      <div className="flex gap-1 overflow-x-auto px-2 sm:px-4 [scrollbar-width:none]">
        {tabs.map((t) => {
          const href = base + t.path;
          const active = t.path === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={t.label}
              href={href}
              className={clsx(
                "relative shrink-0 px-3 py-3 text-sm",
                active ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-fg" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function NotFoundPanel({ what }: { what: string }) {
  const { team } = useParams<{ team: string }>();
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">{what} not found</h1>
      <p className="mt-2 text-fg-muted">It may have been deleted, or you might not have access.</p>
      <Link href={`/${team}`} className="mt-6 inline-block text-sm text-accent hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-8 flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-fg-muted">
        {title} isn&apos;t part of this replica yet.
      </div>
    </div>
  );
}

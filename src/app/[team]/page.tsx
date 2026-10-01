"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ChevronDown, GitBranch, LayoutGrid, List, MoreHorizontal, Plus, Search } from "lucide-react";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import { DashboardTabs, NotFoundPanel } from "@/components/dashboard-header";
import { Avatar, Button, Card, GitHubIcon, Input, Menu, MenuItem, StatusDot, timeAgo } from "@/components/ui";

export default function TeamOverviewPage() {
  const { team } = useParams<{ team: string }>();
  const { state } = useStore();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  if (!state.teams.some((t) => t.slug === team)) return <NotFoundPanel what="Team" />;

  const projects = state.projects
    .filter((p) => p.teamSlug === team && p.name.includes(query.toLowerCase()))
    .map((p) => {
      const deployments = state.deployments.filter((d) => d.projectId === p.id).sort((a, b) => b.createdAt - a.createdAt);
      const production = deployments.find((d) => d.current) ?? deployments[0];
      const domain = state.domains.find((d) => d.projectId === p.id && !d.gitBranch && !d.redirect);
      return { ...p, production, domain, lastActivity: deployments[0]?.createdAt ?? p.createdAt };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);

  return (
    <>
      <DashboardTabs />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Projects..." className="pl-9" />
          </div>
          <div className="flex gap-2">
            <div className="flex rounded-md border border-border bg-bg p-1">
              {(["grid", "list"] as const).map((v) => (
                <button
                  key={v}
                  aria-label={`${v} view`}
                  onClick={() => setView(v)}
                  className={clsx("rounded px-2", view === v ? "bg-bg-muted text-fg" : "text-fg-muted")}
                >
                  {v === "grid" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
                </button>
              ))}
            </div>
            <Menu
              trigger={(toggle) => (
                <Button variant="primary" onClick={toggle}>
                  Add New... <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <Link href="/new" onClick={close}>
                    <MenuItem>Project</MenuItem>
                  </Link>
                  <MenuItem onClick={close}>Domain</MenuItem>
                  <MenuItem onClick={close}>Store</MenuItem>
                  <MenuItem onClick={close}>Team</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        {projects.length === 0 ? (
          <Card className="mt-6 flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-fg-muted">No projects found.</p>
            <Link href="/new">
              <Button variant="primary">
                <Plus className="h-4 w-4" /> New Project
              </Button>
            </Link>
          </Card>
        ) : (
          <div className={clsx("mt-6 grid gap-4", view === "grid" ? "sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1")}>
            {projects.map((p) => (
              <Card key={p.id} className="group relative p-5 transition-colors hover:border-border-strong">
                <Link href={`/${team}/${p.name}`} className="absolute inset-0" aria-label={p.name} />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={p.name} size={32} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-sm text-fg-muted">{p.domain?.name ?? "No domain"}</p>
                    </div>
                  </div>
                  <div className="relative z-10">
                    <Menu
                      trigger={(toggle) => (
                        <button onClick={toggle} aria-label="Project actions" className="rounded p-1 text-fg-muted hover:bg-bg-muted">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <Link href={`/${team}/${p.name}/settings`} onClick={close}>
                            <MenuItem>Settings</MenuItem>
                          </Link>
                          <Link href={`/${team}/${p.name}/settings/domains`} onClick={close}>
                            <MenuItem>Manage Domains</MenuItem>
                          </Link>
                        </>
                      )}
                    </Menu>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-bg-muted px-2.5 py-1 text-xs font-medium">
                  <GitHubIcon className="h-3.5 w-3.5" /> {p.repo}
                </span>
                {p.production && (
                  <div className="mt-4 space-y-1 text-sm">
                    <p className="truncate">{p.production.commitMessage}</p>
                    <p className="flex items-center gap-1.5 text-fg-muted">
                      {timeAgo(p.production.createdAt)} on <GitBranch className="h-3.5 w-3.5" /> {p.production.branch}
                      <span className="ml-auto">
                        <StatusDot status={p.production.status} label={false} />
                      </span>
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

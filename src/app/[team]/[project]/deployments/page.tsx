"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { GitBranch, GitCommitHorizontal, MoreHorizontal, Search } from "lucide-react";
import { useProject, useStore } from "@/lib/store";
import type { DeploymentStatus } from "@/lib/types";
import { Avatar, Badge, Card, Input, Menu, MenuItem, Select, StatusDot, timeAgo } from "@/components/ui";

export default function DeploymentsPage() {
  const { team, project: name } = useParams<{ team: string; project: string }>();
  const { project, deployments } = useProject(team, name);
  const { deploy, dispatch } = useStore();
  const [branch, setBranch] = useState("");
  const [env, setEnv] = useState("all");
  const [status, setStatus] = useState<"all" | DeploymentStatus>("all");
  if (!project) return null;

  const rows = deployments.filter(
    (d) =>
      d.branch.includes(branch) &&
      (env === "all" || d.environment === env) &&
      (status === "all" || d.status === status),
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Deployments</h1>
      <p className="mt-2 text-sm text-fg-muted">Continuously generated from {project.repo}</p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="All Branches..." className="pl-9" />
        </div>
        <Select value={env} onChange={(e) => setEnv(e.target.value)} className="sm:w-48">
          <option value="all">All Environments</option>
          <option value="Production">Production</option>
          <option value="Preview">Preview</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm:w-40">
          <option value="all">Status: All</option>
          {(["Ready", "Building", "Queued", "Error", "Canceled"] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <Card className="mt-6 divide-y divide-border">
        {rows.length === 0 && <p className="p-8 text-center text-sm text-fg-muted">No deployments match your filters.</p>}
        {rows.map((d) => (
          <div key={d.id} className="grid grid-cols-1 gap-3 px-5 py-4 text-sm md:grid-cols-[1.4fr_1fr_1.6fr_auto] md:items-center">
            <div className="min-w-0">
              <p className="truncate font-medium">{d.url.slice(project.name.length + 1).split("-")[0]}</p>
              <p className="mt-0.5 flex items-center gap-2 text-fg-muted">
                {d.environment}
                {d.current && <Badge tone="blue">Current</Badge>}
              </p>
            </div>
            <div>
              <StatusDot status={d.status} />
              <p className="mt-0.5 text-fg-muted">{d.status === "Ready" || d.status === "Error" ? `${d.durationSec}s` : "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 shrink-0" /> <span className="truncate">{d.branch}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-fg-muted">
                <GitCommitHorizontal className="h-4 w-4 shrink-0" />
                <span className="font-mono text-xs">{d.commitSha}</span>
                <span className="truncate">{d.commitMessage}</span>
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 md:justify-end">
              <span className="flex items-center gap-2 text-fg-muted">
                {timeAgo(d.createdAt)} by {d.author} <Avatar name={d.author} size={20} />
              </span>
              <Menu
                trigger={(toggle) => (
                  <button onClick={toggle} aria-label="Deployment actions" className="rounded p-1 text-fg-muted hover:bg-bg-muted">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem
                      onClick={() => {
                        close();
                        window.open(`https://${d.url}`, "_blank");
                      }}
                    >
                      Visit
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        close();
                        navigator.clipboard?.writeText(`https://${d.url}`);
                      }}
                    >
                      Copy URL
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        close();
                        deploy(project, { branch: d.branch, message: `Redeploy of ${d.commitSha}` });
                      }}
                    >
                      Redeploy
                    </MenuItem>
                    {d.status === "Ready" && !d.current && (
                      <MenuItem
                        onClick={() => {
                          close();
                          dispatch({ type: "promoteDeployment", id: d.id });
                        }}
                      >
                        Promote to Production
                      </MenuItem>
                    )}
                    {(d.status === "Building" || d.status === "Queued") && (
                      <MenuItem
                        danger
                        onClick={() => {
                          close();
                          dispatch({ type: "updateDeployment", id: d.id, patch: { status: "Canceled" } });
                        }}
                      >
                        Cancel Deployment
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            </div>
          </div>
        ))}
      </Card>
    </main>
  );
}

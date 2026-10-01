"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ExternalLink, GitBranch, GitCommitHorizontal, Globe, RotateCw } from "lucide-react";
import { useProject, useStore } from "@/lib/store";
import { Button, Card, GitHubIcon, StatusDot, timeAgo } from "@/components/ui";

export default function ProjectOverviewPage() {
  const { team, project: name } = useParams<{ team: string; project: string }>();
  const { project, domains, deployments } = useProject(team, name);
  const { deploy } = useStore();
  if (!project) return null;

  const production = deployments.find((d) => d.current) ?? deployments.find((d) => d.environment === "Production");
  const productionDomains = domains.filter((d) => !d.gitBranch);
  const previews = deployments.filter((d) => d.environment === "Preview").slice(0, 3);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
        <div className="flex flex-wrap gap-2">
          <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer">
            <Button>
              <GitHubIcon /> Repository
            </Button>
          </a>
          <Link href={`/${team}/${project.name}/settings/domains`}>
            <Button>Domains</Button>
          </Link>
          {production && (
            <a href={`https://${productionDomains[0]?.name ?? production.url}`} target="_blank" rel="noreferrer">
              <Button variant="primary">Visit</Button>
            </a>
          )}
        </div>
      </div>

      <Card className="mt-8 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-medium">Production Deployment</h2>
          <div className="flex gap-2">
            <Link href={`/${team}/${project.name}/deployments`}>
              <Button size="sm">Build Logs</Button>
            </Link>
            <Button size="sm" onClick={() => deploy(project, { message: "Redeploy of production" })}>
              <RotateCw className="h-3.5 w-3.5" /> Redeploy
            </Button>
          </div>
        </div>
        {production ? (
          <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-md border border-border bg-gradient-to-br from-bg-muted to-bg">
              <div className="w-3/4 space-y-2">
                <div className="h-3 w-1/3 rounded bg-border-strong" />
                <div className="h-6 w-2/3 rounded bg-border" />
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded bg-border" />
                  ))}
                </div>
              </div>
            </div>
            <dl className="grid content-start gap-5 text-sm">
              <div>
                <dt className="text-fg-muted">Deployment</dt>
                <dd className="mt-1 truncate font-medium">{production.url}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Domains</dt>
                <dd className="mt-1 space-y-1">
                  {productionDomains.map((d) => (
                    <a key={d.id} href={`https://${d.name}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium hover:underline">
                      <span className="truncate">{d.name}</span> <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ))}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-fg-muted">Status</dt>
                  <dd className="mt-1">
                    <StatusDot status={production.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Created</dt>
                  <dd className="mt-1">
                    {timeAgo(production.createdAt)} by {production.author}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="text-fg-muted">Source</dt>
                <dd className="mt-1 space-y-1">
                  <p className="flex items-center gap-1.5">
                    <GitBranch className="h-4 w-4" /> {production.branch}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <GitCommitHorizontal className="h-4 w-4" />
                    <span className="font-mono text-xs">{production.commitSha}</span> {production.commitMessage}
                  </p>
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="p-6 text-sm text-fg-muted">No production deployment yet.</p>
        )}
      </Card>

      <h2 className="mt-10 text-lg font-semibold">Active Branches</h2>
      <Card className="mt-4 divide-y divide-border">
        {previews.length === 0 && <p className="p-6 text-sm text-fg-muted">No preview deployments.</p>}
        {previews.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-4 px-6 py-4 text-sm">
            <span className="flex w-40 items-center gap-1.5 font-medium">
              <GitBranch className="h-4 w-4" /> {d.branch}
            </span>
            <span className="min-w-0 flex-1 truncate text-fg-muted">{d.commitMessage}</span>
            <StatusDot status={d.status} />
            <span className="w-20 text-right text-fg-muted">{timeAgo(d.createdAt)}</span>
          </div>
        ))}
      </Card>

      <p className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
        <Globe className="h-4 w-4" /> To update your Production Deployment, push to the &quot;{project.productionBranch}&quot; branch.
      </p>
    </main>
  );
}

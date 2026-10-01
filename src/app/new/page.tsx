"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Lock, Search } from "lucide-react";
import { newDomain, uid, useStore } from "@/lib/store";
import { DEFAULT_TEAM, CURRENT_USER } from "@/lib/seed";
import type { Project } from "@/lib/types";
import { Button, Card, GitHubIcon, Input, Logo, Select, timeAgo } from "@/components/ui";

const REPOS = [
  { name: "sakshi-srepo", framework: "Next.js", updated: Date.now() - 3600_000, private: false },
  { name: "shop-frontend", framework: "Next.js", updated: Date.now() - 2 * 86400_000, private: true },
  { name: "blog", framework: "Astro", updated: Date.now() - 6 * 86400_000, private: false },
  { name: "landing-page", framework: "Vite", updated: Date.now() - 14 * 86400_000, private: false },
  { name: "api-server", framework: "Other", updated: Date.now() - 30 * 86400_000, private: true },
];

const TEMPLATES = ["Next.js Boilerplate", "AI Chatbot", "Commerce", "Blog Starter"];

export default function NewProjectPage() {
  const { state, dispatch, deploy } = useStore();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(typeof REPOS)[number] | null>(null);
  const [name, setName] = useState("");
  const [framework, setFramework] = useState("Next.js");
  const [error, setError] = useState<string | null>(null);

  const pick = (repo: (typeof REPOS)[number]) => {
    setSelected(repo);
    setName(repo.name);
    setFramework(repo.framework);
    setError(null);
  };

  const create = () => {
    if (!selected) return;
    const n = name.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9._-]{0,98}[a-z0-9])?$/.test(n)) return setError("Invalid project name.");
    if (state.projects.some((p) => p.teamSlug === DEFAULT_TEAM && p.name === n)) return setError("A project with this name already exists.");
    if (state.domains.some((d) => d.name === `${n}.vercel.app`)) return setError(`${n}.vercel.app is already taken.`);
    const project: Project = {
      id: uid("prj"),
      name: n,
      teamSlug: DEFAULT_TEAM,
      framework,
      repo: `${CURRENT_USER}/${selected.name}`,
      productionBranch: "main",
      createdAt: Date.now(),
    };
    dispatch({ type: "addProject", project, domain: newDomain(project.id, `${n}.vercel.app`) });
    deploy(project, { message: "Initial commit" });
    router.push(`/${DEFAULT_TEAM}/${n}`);
  };

  const repos = REPOS.filter((r) => r.name.includes(query.toLowerCase()));

  return (
    <div className="min-h-screen bg-bg-subtle">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-bg px-6">
        <Link href={`/${DEFAULT_TEAM}`} aria-label="Dashboard">
          <Logo className="h-[22px] w-[22px]" />
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Link href={`/${DEFAULT_TEAM}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Let&apos;s build something new.</h1>
        <p className="mt-2 text-fg-muted">To deploy a new Project, import an existing Git Repository or get started with one of our Templates.</p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="text-xl font-semibold">{selected ? "Configure Project" : "Import Git Repository"}</h2>
            {!selected ? (
              <>
                <div className="mt-4 flex gap-2">
                  <Button className="shrink-0">
                    <GitHubIcon /> {CURRENT_USER}
                  </Button>
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="pl-9" />
                  </div>
                </div>
                <ul className="mt-4 divide-y divide-border rounded-md border border-border">
                  {repos.map((r) => (
                    <li key={r.name} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        {r.private && <Lock className="h-3.5 w-3.5 text-fg-muted" />}
                        <span className="shrink-0 text-fg-muted">· {timeAgo(r.updated)}</span>
                      </span>
                      <Button size="sm" variant="primary" onClick={() => pick(r)}>
                        Import
                      </Button>
                    </li>
                  ))}
                  {repos.length === 0 && <li className="px-4 py-6 text-center text-sm text-fg-muted">No repositories found.</li>}
                </ul>
              </>
            ) : (
              <div className="mt-4 space-y-4 text-sm">
                <p className="flex items-center gap-2 text-fg-muted">
                  Importing from <GitHubIcon /> <span className="font-medium text-fg">{CURRENT_USER}/{selected.name}</span>
                </p>
                <div>
                  <label className="mb-1 block text-fg-muted">Project Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-fg-muted">Framework Preset</label>
                  <Select value={framework} onChange={(e) => setFramework(e.target.value)}>
                    {["Next.js", "Astro", "Vite", "SvelteKit", "Nuxt", "Remix", "Other"].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </Select>
                </div>
                {error && <p className="text-danger">{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={() => setSelected(null)}>Back</Button>
                  <Button variant="primary" className="flex-1" onClick={create}>
                    Deploy
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold">Clone Template</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {TEMPLATES.map((t, i) => (
                <div key={t} className="overflow-hidden rounded-md border border-border">
                  <div
                    className="aspect-video"
                    style={{ background: `linear-gradient(135deg, hsl(${i * 70 + 200} 70% 55%), hsl(${i * 70 + 260} 70% 40%))` }}
                  />
                  <p className="px-3 py-2 text-sm font-medium">{t}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

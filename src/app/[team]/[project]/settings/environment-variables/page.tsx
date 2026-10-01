"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { uid, useProject, useStore } from "@/lib/store";
import type { Environment } from "@/lib/types";
import { Badge, Button, Card, Input, timeAgo } from "@/components/ui";

const ENVIRONMENTS: Environment[] = ["Production", "Preview", "Development"];

export default function EnvironmentVariablesPage() {
  const { team, project: name } = useParams<{ team: string; project: string }>();
  const { project, envVars } = useProject(team, name);
  const { dispatch } = useStore();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [targets, setTargets] = useState<Environment[]>(ENVIRONMENTS);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  if (!project) return null;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return setError("Keys may only contain letters, digits and underscores, and can't start with a digit.");
    if (targets.length === 0) return setError("Select at least one environment.");
    const clash = envVars.find((v) => v.key === k && v.targets.some((t) => targets.includes(t)));
    if (clash) return setError(`A variable named ${k} already exists for one of the selected environments.`);
    dispatch({ type: "addEnvVar", envVar: { id: uid("env"), projectId: project.id, key: k, value, targets, createdAt: Date.now() } });
    setKey("");
    setValue("");
    setError(null);
  };

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Environment Variables</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Store API keys and other configuration as encrypted variables, scoped per environment. Changes apply to new deployments only.
        </p>
      </div>

      <Card>
        <form onSubmit={add} className="space-y-4 p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-fg-muted">Key</label>
              <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="EXAMPLE_NAME" className="font-mono" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-fg-muted">Value</label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="I9JU23NF394R6HH" className="font-mono" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {ENVIRONMENTS.map((env) => (
              <label key={env} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={targets.includes(env)}
                  onChange={(e) => setTargets((t) => (e.target.checked ? [...t, env] : t.filter((x) => x !== env)))}
                />
                {env}
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={!key}>
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card className="divide-y divide-border">
        {envVars.length === 0 && <p className="p-8 text-center text-sm text-fg-muted">No Environment Variables added yet.</p>}
        {envVars.map((v) => (
          <div key={v.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-medium">{v.key}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {v.targets.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-sm text-fg-muted">
              <button onClick={() => toggleReveal(v.id)} aria-label={revealed.has(v.id) ? "Hide value" : "Reveal value"}>
                {revealed.has(v.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <span className="truncate">{revealed.has(v.id) ? v.value || '""' : "••••••••••••"}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-fg-muted">
              Added {timeAgo(v.createdAt)}
              <button
                aria-label={`Delete ${v.key}`}
                onClick={() => dispatch({ type: "removeEnvVar", id: v.id })}
                className="rounded p-1 hover:bg-bg-muted hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

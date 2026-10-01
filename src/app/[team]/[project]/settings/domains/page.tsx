"use client";

import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, ExternalLink, GitBranch, Info, MoreHorizontal, RefreshCw } from "lucide-react";
import { newDomain, useProject, useStore } from "@/lib/store";
import { isApex, isVercelApp, normalizeDomain, validateDomain, VERCEL_A_RECORD, VERCEL_CNAME } from "@/lib/domains";
import type { Domain, Project, RedirectStatus } from "@/lib/types";
import { Badge, Button, Card, Input, Menu, MenuItem, Modal, Select } from "@/components/ui";

const REDIRECT_CODES: { value: RedirectStatus; label: string }[] = [
  { value: 307, label: "307 Temporary Redirect" },
  { value: 308, label: "308 Permanent Redirect" },
  { value: 301, label: "301 Moved Permanently" },
  { value: 302, label: "302 Found" },
];

export default function DomainsSettingsPage() {
  const { team, project: name } = useParams<{ team: string; project: string }>();
  const { project, domains } = useProject(team, name);
  const [adding, setAdding] = useState(false);
  if (!project) return null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Domains</h2>
          <p className="mt-2 max-w-xl text-sm text-fg-muted">
            These domains are assigned to your Production Deployments. Optionally, a different Git branch or a redirection to
            another domain can be configured for each one.{" "}
            <a href="https://vercel.com/docs/domains" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Learn more
            </a>
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add Domain
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        {domains.length === 0 && (
          <Card className="p-10 text-center text-sm text-fg-muted">No domains yet. Add one to get started.</Card>
        )}
        {[...domains]
          .sort((a, b) => Number(isVercelApp(a.name)) - Number(isVercelApp(b.name)) || a.createdAt - b.createdAt)
          .map((d) => (
            <DomainCard key={d.id} domain={d} project={project} siblings={domains} />
          ))}
      </div>

      <AddDomainModal open={adding} onClose={() => setAdding(false)} project={project} existing={domains} />
    </div>
  );
}

function DomainCard({ domain, project, siblings }: { domain: Domain; project: Project; siblings: Domain[] }) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    // Simulate a DNS lookup. In this replica a refresh always "finds" the records.
    setTimeout(() => {
      dispatch({ type: "updateDomain", id: domain.id, patch: { verified: true } });
      setRefreshing(false);
    }, 1200);
  };

  const status = domain.verified ? "valid" : "invalid";

  return (
    <Card>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <a
            href={`https://${domain.name}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 break-all text-base font-semibold hover:underline"
          >
            {domain.name} <ExternalLink className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          </a>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {status === "invalid" ? (
              <span className="flex items-center gap-1.5 text-danger">
                <AlertTriangle className="h-4 w-4" /> Invalid Configuration
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-accent">
                <CheckCircle2 className="h-4 w-4" /> Valid Configuration
              </span>
            )}
            {domain.redirect ? (
              <span className="flex items-center gap-1.5 text-fg-muted">
                <ArrowRight className="h-4 w-4" /> Redirects to
                <span className="font-medium text-fg">{domain.redirect.to}</span>
                <Badge>{domain.redirect.status}</Badge>
              </span>
            ) : domain.gitBranch ? (
              <span className="flex items-center gap-1.5 text-fg-muted">
                <GitBranch className="h-4 w-4" /> Preview · <span className="font-medium text-fg">{domain.gitBranch}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-fg-muted">
                <GitBranch className="h-4 w-4" /> Production
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isVercelApp(domain.name) && (
            <Button size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={clsx("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Menu
            trigger={(toggle) => (
              <Button size="sm" variant="ghost" onClick={toggle} aria-label="More actions" className="px-2">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    navigator.clipboard?.writeText(domain.name);
                  }}
                >
                  Copy Domain
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    setRemoving(true);
                  }}
                >
                  Remove
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      {status === "invalid" && <DnsInstructions name={domain.name} />}

      {editing && (
        <EditDomainModal open onClose={() => setEditing(false)} domain={domain} project={project} siblings={siblings} />
      )}
      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove Domain"
        footer={
          <>
            <Button onClick={() => setRemoving(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                dispatch({ type: "removeDomain", id: domain.id });
                setRemoving(false);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Are you sure you want to remove <span className="font-medium text-fg">{domain.name}</span> from{" "}
          <span className="font-medium text-fg">{project.name}</span>? Any domains redirecting to it will stop redirecting.
        </p>
      </Modal>
    </Card>
  );
}

function DnsInstructions({ name }: { name: string }) {
  const apex = isApex(name);
  const [tab, setTab] = useState<"a" | "ns">("a");
  const record = apex
    ? { type: "A", name: "@", value: VERCEL_A_RECORD }
    : { type: "CNAME", name: name.split(".").slice(0, -2).join("."), value: VERCEL_CNAME };

  return (
    <div className="rounded-b-lg border-t border-border bg-bg-subtle px-5 py-5 text-sm">
      <div className="mb-4 flex gap-4 border-b border-border">
        <button onClick={() => setTab("a")} className={clsx("-mb-px border-b-2 pb-2", tab === "a" ? "border-fg font-medium" : "border-transparent text-fg-muted")}>
          {apex ? "A Record" : "CNAME Record"}
        </button>
        {apex && (
          <button onClick={() => setTab("ns")} className={clsx("-mb-px border-b-2 pb-2", tab === "ns" ? "border-fg font-medium" : "border-transparent text-fg-muted")}>
            Vercel DNS
          </button>
        )}
      </div>
      {tab === "a" ? (
        <>
          <p className="text-fg-muted">To configure your domain, set the following record on your DNS provider:</p>
          <div className="mt-4 overflow-x-auto rounded-md border border-border bg-bg">
            <table className="w-full text-left">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                <tr className="border-t border-border">
                  <td className="px-4 py-2.5">{record.type}</td>
                  <td className="px-4 py-2.5">{record.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      {record.value} <CopyButton text={record.value} />
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className="text-fg-muted">Set the following nameservers at your domain registrar:</p>
          <ul className="mt-4 space-y-2 font-mono text-[13px]">
            {["ns1.vercel-dns.com", "ns2.vercel-dns.com"].map((ns) => (
              <li key={ns} className="flex items-center gap-2 rounded-md border border-border bg-bg px-4 py-2.5">
                {ns} <CopyButton text={ns} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 flex items-start gap-2 text-xs text-fg-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Depending on your provider, it might take some time for DNS changes to apply. Press Refresh to check again.
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="text-fg-muted hover:text-fg"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function AddDomainModal({
  open,
  onClose,
  project,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  existing: Domain[];
}) {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const [addWww, setAddWww] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const name = normalizeDomain(value);
  const apex = !!name && isApex(name);

  const close = useCallback(() => {
    setValue("");
    setError(null);
    setAddWww(true);
    onClose();
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateDomain(name);
    if (invalid) return setError(invalid);
    const taken = state.domains.find((d) => d.name === name);
    if (taken) {
      const owner = state.projects.find((p) => p.id === taken.projectId);
      return setError(
        taken.projectId === project.id
          ? `${name} is already added to this project.`
          : `${name} is already in use by project "${owner?.name ?? "another project"}".`,
      );
    }
    if (isVercelApp(name) && name.split(".").length !== 3) return setError("Only one level of subdomain is allowed on vercel.app.");

    if (apex && addWww) {
      // Vercel's recommended setup: www serves the site, apex redirects to it.
      const www = `www.${name}`;
      if (!existing.some((d) => d.name === www)) dispatch({ type: "addDomain", domain: newDomain(project.id, www) });
      dispatch({ type: "addDomain", domain: newDomain(project.id, name, { redirect: { to: www, status: 308 } }) });
    } else {
      dispatch({ type: "addDomain", domain: newDomain(project.id, name) });
    }
    close();
  };

  return (
    <Modal open={open} onClose={close} title="Add Domain">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-fg-muted">
          Enter the domain you want to add to <span className="font-medium text-fg">{project.name}</span>.
        </p>
        <Input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="example.com"
          aria-invalid={!!error}
          className={clsx(error && "border-danger")}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        {apex && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
            <input type="checkbox" checked={addWww} onChange={(e) => setAddWww(e.target.checked)} className="mt-0.5 accent-current" />
            <span>
              <span className="font-medium">Add www.{name} and redirect {name} to it</span>
              <span className="mt-0.5 block text-fg-muted">Recommended. Serves your site on www and redirects the apex domain with a 308.</span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditDomainModal({
  open,
  onClose,
  domain,
  project,
  siblings,
}: {
  open: boolean;
  onClose: () => void;
  domain: Domain;
  project: Project;
  siblings: Domain[];
}) {
  const { dispatch } = useStore();
  const [mode, setMode] = useState<"none" | "redirect">(domain.redirect ? "redirect" : "none");
  const [redirectTo, setRedirectTo] = useState(domain.redirect?.to ?? "");
  const [code, setCode] = useState<RedirectStatus>(domain.redirect?.status ?? 307);
  const [environment, setEnvironment] = useState<"production" | "preview">(domain.gitBranch ? "preview" : "production");
  const [branch, setBranch] = useState(domain.gitBranch ?? "");
  const [error, setError] = useState<string | null>(null);

  // Redirect targets must be another domain in this project that isn't itself a redirect.
  const targets = siblings.filter((d) => d.id !== domain.id && !d.redirect);

  const save = () => {
    if (mode === "redirect") {
      if (!redirectTo) return setError("Choose a domain to redirect to.");
      dispatch({ type: "updateDomain", id: domain.id, patch: { redirect: { to: redirectTo, status: code }, gitBranch: null } });
    } else {
      const b = branch.trim();
      if (environment === "preview" && !b) return setError("Enter a Git branch.");
      dispatch({
        type: "updateDomain",
        id: domain.id,
        patch: { redirect: null, gitBranch: environment === "preview" && b !== project.productionBranch ? b : null },
      });
    }
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${domain.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">Redirect to Another Domain</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "none"} onChange={() => setMode("none")} /> No redirect
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "redirect"} onChange={() => setMode("redirect")} disabled={targets.length === 0} />
            Redirect {targets.length === 0 && <span className="text-fg-muted">(add another domain first)</span>}
          </label>
        </fieldset>

        {mode === "redirect" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={redirectTo} onChange={(e) => setRedirectTo(e.target.value)}>
              <option value="">Select domain…</option>
              {targets.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select value={code} onChange={(e) => setCode(Number(e.target.value) as RedirectStatus)}>
              {REDIRECT_CODES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-medium">Connect to an Environment</p>
            <Select value={environment} onChange={(e) => setEnvironment(e.target.value as typeof environment)}>
              <option value="production">Production</option>
              <option value="preview">Preview</option>
            </Select>
            {environment === "preview" && (
              <div>
                <label className="mb-1 block text-fg-muted">Git Branch</label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. staging" />
              </div>
            )}
          </div>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

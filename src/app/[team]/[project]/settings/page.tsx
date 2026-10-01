"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useProject, useStore } from "@/lib/store";
import { Button, Card, Input, Modal } from "@/components/ui";

function Section({
  title,
  description,
  children,
  footer,
  danger,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className={danger ? "border-danger/40" : undefined}>
      <div className="space-y-3 p-6">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-fg-muted">{description}</p>
        {children}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-border bg-bg-subtle px-6 py-3">{footer}</div>
    </Card>
  );
}

export default function GeneralSettingsPage() {
  const { team, project: name } = useParams<{ team: string; project: string }>();
  const { project } = useProject(team, name);
  const { state, dispatch } = useStore();
  const router = useRouter();
  const [projectName, setProjectName] = useState(name);
  const [branch, setBranch] = useState(project?.productionBranch ?? "main");
  const [nameError, setNameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  if (!project) return null;

  const saveName = () => {
    const next = projectName.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9._-]{0,98}[a-z0-9])?$/.test(next)) {
      return setNameError("Names can only contain lowercase letters, digits, '.', '_' and '-'.");
    }
    if (next !== project.name && state.projects.some((p) => p.teamSlug === team && p.name === next)) {
      return setNameError("A project with this name already exists.");
    }
    setNameError(null);
    dispatch({ type: "updateProject", id: project.id, patch: { name: next } });
    router.replace(`/${team}/${next}/settings`);
  };

  return (
    <div className="space-y-6">
      <Section
        title="Project Name"
        description="Used to identify your project on the Dashboard, Vercel CLI, and in the URL of your deployments."
        footer={
          <Button size="sm" variant="primary" onClick={saveName} disabled={projectName === project.name}>
            Save
          </Button>
        }
      >
        <div className="flex max-w-md overflow-hidden rounded-md border border-border">
          <span className="flex items-center border-r border-border bg-bg-subtle px-3 text-sm text-fg-muted">vercel.com/{team.slice(0, 12)}…/</span>
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="rounded-none border-0" />
        </div>
        {nameError && <p className="text-sm text-danger">{nameError}</p>}
      </Section>

      <Section
        title="Production Branch"
        description="Commits pushed to this branch create Production Deployments. All other branches create Preview Deployments."
        footer={
          <Button
            size="sm"
            variant="primary"
            disabled={!branch.trim() || branch === project.productionBranch}
            onClick={() => dispatch({ type: "updateProject", id: project.id, patch: { productionBranch: branch.trim() } })}
          >
            Save
          </Button>
        }
      >
        <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="max-w-xs" />
      </Section>

      <Section
        title="Framework Preset"
        description="The framework used to build and serve this project."
        footer={<span className="text-sm text-fg-muted">Detected automatically from {project.repo}</span>}
      >
        <p className="text-sm font-medium">{project.framework}</p>
      </Section>

      <Section
        danger
        title="Delete Project"
        description="The project will be permanently deleted, including its deployments and domains. This action is irreversible and can not be undone."
        footer={
          <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete Project"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={confirm !== project.name}
              onClick={() => {
                dispatch({ type: "removeProject", id: project.id });
                router.push(`/${team}`);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Enter the project name <span className="font-medium text-fg">{project.name}</span> to continue:
        </p>
        <Input className="mt-3" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
      </Modal>
    </div>
  );
}

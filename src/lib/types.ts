export type Environment = "Production" | "Preview" | "Development";

export interface Team {
  slug: string;
  name: string;
  plan: "Hobby" | "Pro";
}

export interface Project {
  id: string;
  name: string;
  teamSlug: string;
  framework: string;
  repo: string;
  productionBranch: string;
  createdAt: number;
}

export type RedirectStatus = 301 | 302 | 307 | 308;

export interface Domain {
  id: string;
  projectId: string;
  name: string;
  /** Simulated DNS state. `.vercel.app` domains are always verified. */
  verified: boolean;
  redirect: { to: string; status: RedirectStatus } | null;
  /** null = Production; a branch name = Preview for that branch */
  gitBranch: string | null;
  createdAt: number;
}

export type DeploymentStatus = "Ready" | "Building" | "Queued" | "Error" | "Canceled";

export interface Deployment {
  id: string;
  projectId: string;
  url: string;
  status: DeploymentStatus;
  environment: Exclude<Environment, "Development">;
  branch: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  createdAt: number;
  durationSec: number;
  current?: boolean;
}

export interface EnvVar {
  id: string;
  projectId: string;
  key: string;
  value: string;
  targets: Environment[];
  createdAt: number;
}

export interface State {
  teams: Team[];
  projects: Project[];
  domains: Domain[];
  deployments: Deployment[];
  envVars: EnvVar[];
}

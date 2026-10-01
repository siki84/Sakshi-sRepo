"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { seed, CURRENT_USER } from "./seed";
import { isVercelApp } from "./domains";
import type { Deployment, Domain, EnvVar, Project, State } from "./types";

const STORAGE_KEY = "vercel-clone-state-v1";

type Action =
  | { type: "hydrate"; state: State }
  | { type: "reset" }
  | { type: "addDomain"; domain: Domain }
  | { type: "updateDomain"; id: string; patch: Partial<Domain> }
  | { type: "removeDomain"; id: string }
  | { type: "addProject"; project: Project; domain: Domain }
  | { type: "updateProject"; id: string; patch: Partial<Project> }
  | { type: "removeProject"; id: string }
  | { type: "addDeployment"; deployment: Deployment }
  | { type: "updateDeployment"; id: string; patch: Partial<Deployment> }
  | { type: "promoteDeployment"; id: string }
  | { type: "addEnvVar"; envVar: EnvVar }
  | { type: "removeEnvVar"; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "reset":
      return seed;
    case "addDomain":
      return { ...state, domains: [...state.domains, action.domain] };
    case "updateDomain":
      return {
        ...state,
        domains: state.domains.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      };
    case "removeDomain": {
      const removed = state.domains.find((d) => d.id === action.id);
      return {
        ...state,
        // Drop the domain and any redirects that pointed at it.
        domains: state.domains
          .filter((d) => d.id !== action.id)
          .map((d) => (removed && d.redirect?.to === removed.name ? { ...d, redirect: null } : d)),
      };
    }
    case "addProject":
      return {
        ...state,
        projects: [...state.projects, action.project],
        domains: [...state.domains, action.domain],
      };
    case "updateProject":
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };
    case "removeProject":
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.id),
        domains: state.domains.filter((d) => d.projectId !== action.id),
        deployments: state.deployments.filter((d) => d.projectId !== action.id),
        envVars: state.envVars.filter((e) => e.projectId !== action.id),
      };
    case "addDeployment":
      return { ...state, deployments: [action.deployment, ...state.deployments] };
    case "updateDeployment":
      return {
        ...state,
        // A canceled deployment ignores later updates from its simulated build timers.
        deployments: state.deployments.map((d) =>
          d.id === action.id && d.status !== "Canceled" ? { ...d, ...action.patch } : d,
        ),
      };
    case "promoteDeployment": {
      const target = state.deployments.find((d) => d.id === action.id);
      if (!target || target.status !== "Ready") return state;
      return {
        ...state,
        deployments: state.deployments.map((d) =>
          d.projectId !== target.projectId
            ? d
            : d.id === target.id
              ? { ...d, current: true, environment: "Production" }
              : { ...d, current: false },
        ),
      };
    }
    case "addEnvVar":
      return { ...state, envVars: [...state.envVars, action.envVar] };
    case "removeEnvVar":
      return { ...state, envVars: state.envVars.filter((e) => e.id !== action.id) };
  }
}

export const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const randomHash = () => Math.random().toString(36).slice(2, 11);
const randomSha = () => Math.random().toString(16).slice(2, 9);

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  /** Creates a deployment that goes Queued → Building → Ready like a real build. */
  deploy: (project: Project, opts?: { branch?: string; message?: string }) => Deployment;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, seed);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) dispatch({ type: "hydrate", state: JSON.parse(saved) as State });
    } catch {
      // Corrupt or unavailable storage: keep the seed data.
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked; state still works in memory.
    }
  }, [state]);

  const store = useMemo<Store>(
    () => ({
      state,
      dispatch,
      deploy(project, opts = {}) {
        const branch = opts.branch ?? project.productionBranch;
        const deployment: Deployment = {
          id: uid("dpl"),
          projectId: project.id,
          url: `${project.name}-${randomHash()}-${project.teamSlug}.vercel.app`,
          status: "Queued",
          environment: branch === project.productionBranch ? "Production" : "Preview",
          branch,
          commitSha: randomSha(),
          commitMessage: opts.message ?? "Redeploy",
          author: CURRENT_USER,
          createdAt: Date.now(),
          durationSec: 0,
        };
        dispatch({ type: "addDeployment", deployment });
        setTimeout(() => dispatch({ type: "updateDeployment", id: deployment.id, patch: { status: "Building" } }), 800);
        setTimeout(() => {
          dispatch({
            type: "updateDeployment",
            id: deployment.id,
            patch: { status: "Ready", durationSec: 20 + Math.floor(Math.random() * 30) },
          });
          if (deployment.environment === "Production") dispatch({ type: "promoteDeployment", id: deployment.id });
        }, 4000);
        return deployment;
      },
    }),
    [state],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function useProject(teamSlug: string, projectName: string) {
  const { state } = useStore();
  const project = state.projects.find((p) => p.teamSlug === teamSlug && p.name === projectName);
  return {
    project,
    domains: project ? state.domains.filter((d) => d.projectId === project.id) : [],
    deployments: project
      ? state.deployments.filter((d) => d.projectId === project.id).sort((a, b) => b.createdAt - a.createdAt)
      : [],
    envVars: project ? state.envVars.filter((e) => e.projectId === project.id) : [],
  };
}

export function newDomain(projectId: string, name: string, extra: Partial<Domain> = {}): Domain {
  return {
    id: uid("dom"),
    projectId,
    name,
    verified: isVercelApp(name),
    redirect: null,
    gitBranch: null,
    createdAt: Date.now(),
    ...extra,
  };
}

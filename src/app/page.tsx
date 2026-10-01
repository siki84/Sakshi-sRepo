import Link from "next/link";
import { ArrowRight, Bot, Gauge, GitBranch, Globe, Layers, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/ui";
import { DEFAULT_TEAM } from "@/lib/seed";

const NAV = ["Products", "Resources", "Solutions", "Enterprise", "Docs", "Pricing"];

const FEATURES = [
  { icon: GitBranch, title: "Git-connected deploys", body: "Push to any branch and get a unique Preview URL. Merge to ship to production." },
  { icon: Globe, title: "Global edge network", body: "Serve static assets and functions from regions close to every visitor." },
  { icon: Bot, title: "AI-ready infrastructure", body: "Stream responses, run agents, and scale functions without managing servers." },
  { icon: Gauge, title: "Speed Insights", body: "Measure real-user Core Web Vitals and catch regressions before they ship." },
  { icon: ShieldCheck, title: "Built-in security", body: "Automatic HTTPS, DDoS mitigation, and a programmable firewall." },
  { icon: Layers, title: "Framework-defined", body: "First-class support for Next.js, Svelte, Nuxt, Astro, Remix and more." },
];

const LOGOS = ["Acme Corp", "Globex", "Initech", "Umbrella", "Hooli", "Stark Ind."];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Logo /> Vercel
            </Link>
            <nav className="hidden gap-1 lg:flex">
              {NAV.map((n) => (
                <a key={n} href="#" className="rounded-full px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-muted hover:text-fg">
                  {n}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/${DEFAULT_TEAM}`} className="hidden h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-bg-muted sm:flex">
              Log In
            </Link>
            <Link href={`/${DEFAULT_TEAM}`} className="flex h-8 items-center rounded-md bg-fg px-3 text-sm font-medium text-bg hover:opacity-90">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0" aria-hidden />
        <div
          className="absolute left-1/2 top-40 h-[480px] w-[900px] max-w-[160vw] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "conic-gradient(from 180deg, #ff4d4d, #f9cb28, #50e3c2, #0070f3, #7928ca, #ff0080, #ff4d4d)" }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-4xl px-4 pb-28 pt-24 text-center sm:px-6">
          <h1 className="text-5xl font-semibold tracking-tighter sm:text-7xl">Build and deploy on the AI Cloud.</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-fg-muted sm:text-xl">
            Vercel provides the developer tools and cloud infrastructure to build, scale, and secure a faster, more personalized web.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/new" className="flex h-12 items-center justify-center gap-2 rounded-full bg-fg px-6 font-medium text-bg hover:opacity-90">
              <Logo className="h-4 w-4" /> Start Deploying
            </Link>
            <a href="#features" className="flex h-12 items-center justify-center rounded-full border border-border bg-bg px-6 font-medium hover:bg-bg-muted">
              Get a Demo
            </a>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          {LOGOS.map((l) => (
            <div key={l} className="flex h-24 items-center justify-center bg-bg text-sm font-bold tracking-wide text-fg-subtle">
              {l}
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">Your product, delivered.</h2>
        <p className="mt-4 max-w-2xl text-lg text-fg-muted">
          Security, speed, and AI included, so you can focus on your users.
        </p>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-bg p-8">
              <Icon className="h-6 w-6" />
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-fg-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-bg-subtle">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-20 sm:px-6 md:flex-row md:items-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ready to deploy?</h2>
          <Link href={`/${DEFAULT_TEAM}`} className="flex h-12 items-center gap-2 rounded-full bg-fg px-6 font-medium text-bg hover:opacity-90">
            Open the Dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            <Logo className="h-4 w-4" /> Vercel replica, built for learning. Not affiliated with Vercel Inc.
          </span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

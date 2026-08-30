import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Fingerprint,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const workflow = [
  {
    step: "01",
    icon: Fingerprint,
    title: "Verify ownership",
    description:
      "Add only identifiers you control, then confirm them before a scan can begin.",
  },
  {
    step: "02",
    icon: ScanSearch,
    title: "Scan with evidence",
    description:
      "Search results are assessed with source, confidence, and evidence tier kept separate.",
  },
  {
    step: "03",
    icon: FileSearch,
    title: "Take focused action",
    description:
      "Review practical risks and act on clear removal or account-security recommendations.",
  },
];

export function DashboardShell() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f8fafc] text-slate-950">
      <header className="relative border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-950/20">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Privacy Lens</p>
              <p className="text-xs text-slate-500">Exposure intelligence</p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-700"
          >
            <LockKeyhole />
            Privacy-first
          </Badge>
        </div>
      </header>
      <section className="relative isolate border-b border-slate-200 bg-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.14),transparent_31%),radial-gradient(circle_at_83%_45%,rgba(16,185,129,0.12),transparent_28%)]" />
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-5 py-16 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <Badge className="mb-5 bg-slate-950">
              <Sparkles />
              Intelligent personal data exposure monitor
            </Badge>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl">
              See your digital exposure.
              <br />
              <span className="text-blue-600">Know what to do next.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              A privacy-preserving workspace to verify your identifiers,
              discover relevant public exposure, and turn evidence into action.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/onboarding">
                  Get started <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/dashboard">View dashboard</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Built around proof of ownership, evidence, and practical action.
            </p>
          </div>
          <Card className="border-slate-200 bg-white/90 shadow-2xl shadow-slate-300/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Exposure overview</CardTitle>
                  <CardDescription>
                    Live data will appear after your first verified scan.
                  </CardDescription>
                </div>
                <span className="grid size-9 place-items-center rounded-full bg-blue-50 text-blue-600">
                  <ScanSearch className="size-5" />
                </span>
              </div>
            </CardHeader>
            <CardContent className="gap-5">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    value: "02",
                    label: "Protected identifiers",
                    tone: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
                  },
                  {
                    value: "04",
                    label: "Sources assessed",
                    tone: "border-blue-100 bg-blue-50/70 text-blue-700",
                  },
                  {
                    value: "03",
                    label: "Actionable findings",
                    tone: "border-violet-100 bg-violet-50/70 text-violet-700",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={"rounded-xl border p-3 " + item.tone}
                  >
                    <p className="text-xl font-semibold">{item.value}</p>
                    <p className="mt-1 text-xs leading-4 text-slate-600">
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                    </span>
                    <p className="text-sm font-semibold text-slate-800">
                      Evidence workspace ready
                    </p>
                  </div>
                  <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[11px] font-medium text-blue-700">
                    4 sources active
                  </Badge>
                </div>

                <p className="text-xs leading-5 text-slate-500">
                  Verify an identifier to activate continuous exposure monitoring across verified intelligence streams:
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                        <ScanSearch className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800">Web Search & Paste Dumps</p>
                        <p className="text-[11px] text-slate-400">Targeted Serper discovery</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 shrink-0">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Ready
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid size-8 place-items-center rounded-lg bg-red-50 text-red-600 shrink-0">
                        <ShieldCheck className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800">Breach Intelligence Corpus</p>
                        <p className="text-[11px] text-slate-400">ExposedOrNot 1.2B+ index</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 shrink-0">
                      <span className="size-1.5 rounded-full bg-blue-500" />
                      Indexed
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid size-8 place-items-center rounded-lg bg-violet-50 text-violet-600 shrink-0">
                        <Fingerprint className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800">Data Broker Removal Registry</p>
                        <p className="text-[11px] text-slate-400">42 opt-out directories</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 shrink-0">
                      <span className="size-1.5 rounded-full bg-violet-500" />
                      Monitored
                    </span>
                  </div>
                </div>

                <Button className="w-full justify-center gap-2" asChild>
                  <Link href="/onboarding">
                    Start verified scan <ArrowRight className="size-4" />
                  </Link>
                </Button>

                <p className="text-center text-[11px] text-slate-400">
                  Privacy-first &bull; Zero-knowledge &bull; DPDP Act 2023 compliant
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-12">
        <div className="mb-7 max-w-4xl">
          <p className="text-sm font-semibold text-blue-600">
            A trustworthy workflow
          </p>
          <h2 className="mt-2 text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[3rem]">
            Every result starts with proof and ends with a practical action.
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {workflow.map(({ step, icon: Icon, title, description }) => (
            <Card
              key={step}
              size="sm"
              className="min-h-[190px] border-slate-200 shadow-sm"
            >
              <CardHeader className="relative flex h-full flex-col gap-0">
                <span className="text-sm font-semibold text-blue-600">
                  {step}
                </span>
                <span className="absolute top-4 right-4 grid size-9 place-items-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon className="size-4" />
                </span>
                <CardTitle className="mt-1 text-xl leading-7 font-semibold group-data-[size=sm]/card:text-xl">
                  {title}
                </CardTitle>
                <CardDescription className="mt-2 leading-6">
                  {description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-5 py-14 lg:grid-cols-[.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold text-blue-600">
              Designed for careful decisions
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              Evidence before intelligence.
            </h2>
            <p className="mt-4 leading-7 text-slate-600">
              The platform distinguishes verified matches from potential leads,
              and document evidence from snippets. That makes the dashboard
              useful without overstating what it knows.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
              <CheckCircle2 className="size-5 text-emerald-600" />
              <p className="mt-3 font-medium">Confirmed matches</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Require exact identifiers or strong corroborating signals.
              </p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-5">
              <FileSearch className="size-5 text-violet-600" />
              <p className="mt-3 font-medium">Potential leads</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Clearly labelled for review, never presented as certainty.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

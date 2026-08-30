"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockFindings, mockIdentifiers } from "./mock-data";
import { AccountSettings } from "./sections/account-settings";
import { EvidenceDrawer } from "./sections/evidence-drawer";
import { FindingsGrid } from "./sections/findings-grid";
import { IdentifierManager } from "./sections/identifier-manager";
import { RemediationCenter } from "./sections/remediation-center";
import { ScanProgress } from "./sections/scan-progress";
import type { Finding, Identifier, ScanSource } from "./types";

const scanSources: ScanSource[] = [
  "Serper",
  "ExposedOrNot",
  "Brokers",
  "GLiNER",
];

export function DashboardClient() {
  const [identifiers, setIdentifiers] = useState<Identifier[]>(mockIdentifiers);
  const [findings, setFindings] = useState<Finding[]>(mockFindings);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [scanning, setScanning] = useState(false);
  const [completed, setCompleted] = useState<ScanSource[]>([]);
  const [scanAccepted, setScanAccepted] = useState(false);
  const [erased, setErased] = useState(false);
  const verified = identifiers.some((item) => item.status === "VERIFIED");

  useEffect(() => {
    fetch("/api/identifiers")
      .then(async (response) => response.ok ? response.json() : { identifiers: [] })
      .then((data) => {
        const savedIdentifiers = data.identifiers ?? [];
        if (savedIdentifiers.length > 0) setIdentifiers(savedIdentifiers);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    if (completed.length === scanSources.length) {
      const finish = window.setTimeout(() => setScanning(false), 700);
      return () => window.clearTimeout(finish);
    }
    const nextSource = scanSources[completed.length];
    const step = window.setTimeout(
      () => setCompleted((current) => [...current, nextSource]),
      1200,
    );
    return () => window.clearTimeout(step);
  }, [completed.length, scanning]);

  const summary = useMemo(
    () => ({
      active: findings.filter((finding) => finding.status !== "REMEDIATED")
        .length,
      critical: findings.filter(
        (finding) =>
          finding.severity === "CRITICAL" && finding.status !== "REMEDIATED",
      ).length,
      protected: identifiers.filter((item) => item.status !== "PENDING").length,
    }),
    [findings, identifiers],
  );

  const startScan = async () => {
    const identifierIds = identifiers.filter((item) => item.status === "VERIFIED" || item.status === "ATTESTED").map((item) => item.id);
    const response = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifierIds }) });
    if (!response.ok) return;
    setCompleted([]);
    setScanning(true);
    setScanAccepted(true);
  };
  const remediate = (id: number) => {
    setFindings((items) =>
      items.map((item) =>
        item.id === id ? { ...item, status: "REMEDIATED" } : item,
      ),
    );
    setSelected((item) =>
      item?.id === id ? { ...item, status: "REMEDIATED" } : item,
    );
  };
  const rescan = () => {
    setFindings((items) =>
      items.map((item) =>
        item.status === "REMEDIATED" ? { ...item, status: "REAPPEARED" } : item,
      ),
    );
    startScan();
  };
  const erase = () => {
    setIdentifiers([]);
    setFindings([]);
    setSelected(null);
    setErased(true);
  };

  if (erased)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
        <Card className="w-full max-w-md border-emerald-200 text-center shadow-xl shadow-emerald-100">
          <CardContent className="items-center py-10">
            <span className="grid size-14 place-items-center rounded-full bg-emerald-100">
              <CheckCircle2 className="size-7 text-emerald-700" />
            </span>
            <h1 className="text-xl font-semibold">Your data has been erased</h1>
            <p className="max-w-sm text-slate-600">
              All dashboard records have been removed from this session.
            </p>
          </CardContent>
        </Card>
      </main>
    );

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-950/15">
              <ShieldCheck className="size-5" />
            </span>
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
            Privacy protected
          </Badge>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-7 shadow-sm sm:px-8">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_90%_20%,rgba(59,130,246,.13),transparent_55%)]" />
          <div className="relative">
            <p className="text-sm font-semibold text-blue-600">Overview</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Your privacy, made actionable.
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-600">
              Review verified identifiers, inspect exposure evidence, and keep
              remediation work moving from one trusted workspace.
            </p>
          </div>
          <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={<ShieldAlert className="text-red-600" />}
              label="Open findings"
              value={summary.active}
              hint="Need attention"
            />
            <SummaryCard
              icon={<ScanSearch className="text-blue-600" />}
              label="Critical risk"
              value={summary.critical}
              hint="Highest priority"
            />
            <SummaryCard
              icon={<CheckCircle2 className="text-emerald-600" />}
              label="Protected identifiers"
              value={summary.protected}
              hint="Verified or attested"
            />
          </div>
        </section>
        <Tabs defaultValue="scan" className="mt-7">
          <TabsList className="w-full justify-start border border-slate-200 bg-white p-1 shadow-sm sm:w-fit">
            <TabsTrigger value="scan">Monitor</TabsTrigger>
            <TabsTrigger value="identifiers">Identifiers</TabsTrigger>
            <TabsTrigger value="settings">Account</TabsTrigger>
          </TabsList>
          <TabsContent value="scan" className="mt-5 space-y-5">
            <ScanProgress
              verified={verified}
              active={scanning}
              completed={completed}
              scanAccepted={scanAccepted}
              onStart={startScan}
            />
            <FindingsGrid findings={findings} onSelect={setSelected} />
            <RemediationCenter
              findings={findings}
              scanning={scanning}
              onRescan={rescan}
            />
          </TabsContent>
          <TabsContent value="identifiers" className="mt-5">
            <IdentifierManager
              identifiers={identifiers}
              onAdd={(identifier) => setIdentifiers((items) => [...items, identifier])}
              onDelete={async (id) => {
                const response = await fetch(`/api/identifiers/${id}`, { method: "DELETE" });
                if (response.ok) setIdentifiers((items) => items.filter((item) => item.id !== id));
              }}
              onVerify={(id) =>
                setIdentifiers((items) =>
                  items.map((item) =>
                    item.id === id
                      ? { ...item, status: "VERIFIED" }
                      : item,
                  ),
                )
              }
            />
          </TabsContent>
          <TabsContent value="settings" className="mt-5">
            <AccountSettings onErase={erase} />
          </TabsContent>
        </Tabs>
      </div>
      <EvidenceDrawer
        finding={selected}
        onClose={() => setSelected(null)}
        onRemediate={remediate}
      />
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/80 p-4">
      <span className="grid size-10 place-items-center rounded-lg bg-slate-50">
        {icon}
      </span>
      <div>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

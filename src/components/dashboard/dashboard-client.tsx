"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Fingerprint,
  LockKeyhole,
  ScanSearch,
  Settings2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockFindings } from "./mock-data";
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
  const [identifiers, setIdentifiers] = useState<Identifier[]>([]);
  const [findings, setFindings] = useState<Finding[]>(mockFindings);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [scanning, setScanning] = useState(false);
  const [completed, setCompleted] = useState<ScanSource[]>([]);
  const [scanAccepted, setScanAccepted] = useState(false);
  const [scanError, setScanError] = useState("");
  const [erased, setErased] = useState(false);
  const verified = identifiers.some((item) => item.status === "VERIFIED");

  useEffect(() => {
    fetch("/api/identifiers")
      .then(async (response) => (response.ok ? response.json() : []))
      .then((data) => {
        setIdentifiers(Array.isArray(data) ? data : []);
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
    const scanable = identifiers.filter(
      (item) => item.status === "VERIFIED" || item.status === "ATTESTED",
    );
    setScanError("");
    setScanAccepted(false);
    if (scanable.length === 0) {
      setScanError("Verify or attest at least one identifier before scanning.");
      return false;
    }
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityId: scanable[0].identityId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setScanError(data.error ?? "The scan was rejected. Please try again.");
        return false;
      }
      setCompleted([]);
      setScanning(true);
      setScanAccepted(true);
      return true;
    } catch {
      setScanError("We couldn't reach the scan service. Check your connection and try again.");
      return false;
    }
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
  const rescan = async () => {
    const accepted = await startScan();
    if (!accepted) return;
    setFindings((items) =>
      items.map((item) =>
        item.status === "REMEDIATED" ? { ...item, status: "REAPPEARED" } : item,
      ),
    );
  };
  const erase = async () => {
    const response = await fetch("/api/account", { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? "The erasure request failed. Please try again.");
    }
    setIdentifiers([]);
    setFindings([]);
    setSelected(null);
    setErased(true);
  };

  if (erased)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f9fc] p-5">
        <Card className="w-full max-w-md border-emerald-200 text-center shadow-xl shadow-emerald-100/70">
          <CardContent className="items-center py-12">
            <span className="grid size-16 place-items-center rounded-full bg-emerald-100">
              <CheckCircle2 className="size-7 text-emerald-700" />
            </span>
            <p className="mt-5 text-sm font-semibold text-emerald-700">ERASURE COMPLETE</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your account data has been erased</h1>
            <p className="mt-3 max-w-sm leading-7 text-slate-600">
              Your identifiers, scan history, findings, recommendations, and consent records have been removed.
            </p>
            <Button className="mt-7" asChild><Link href="/onboarding">Start a new private workspace</Link></Button>
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
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-7 shadow-sm sm:px-8 sm:py-8">
          <div className="absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(circle_at_90%_20%,rgba(59,130,246,.15),transparent_58%)]" />
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
          <div className="relative mt-7 grid gap-3 sm:grid-cols-3">
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
          <TabsList className="dashboard-tabs grid !h-auto w-full grid-cols-3 gap-1 rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-sm shadow-slate-200/50">
            <TabsTrigger
              value="scan"
              data-tone="monitor"
              className="group/tab relative h-10 flex-row items-center justify-start gap-2 rounded-xl px-3 text-left whitespace-nowrap transition-all duration-200 after:hidden data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:bg-slate-100/80 data-[state=inactive]:hover:text-slate-900"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-data-[state=active]/tab:!bg-white/20 group-data-[state=active]/tab:!text-white shrink-0">
                  <ScanSearch className="size-4.5" />
                </span>
                <span className="font-semibold text-sm">Monitor</span>
              </div>
            </TabsTrigger>

            <TabsTrigger
              value="identifiers"
              data-tone="identifiers"
              className="group/tab relative h-10 flex-row items-center justify-start gap-2 rounded-xl px-3 text-left whitespace-nowrap transition-all duration-200 after:hidden data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:bg-slate-100/80 data-[state=inactive]:hover:text-slate-900"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 transition-colors group-data-[state=active]/tab:!bg-white/20 group-data-[state=active]/tab:!text-white shrink-0">
                  <Fingerprint className="size-4.5" />
                </span>
                <span className="font-semibold text-sm">Identifiers</span>
              </div>
            </TabsTrigger>

            <TabsTrigger
              value="settings"
              data-tone="account"
              className="group/tab relative h-10 flex-row items-center justify-start gap-2 rounded-xl px-3 text-left whitespace-nowrap transition-all duration-200 after:hidden data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:bg-slate-100/80 data-[state=inactive]:hover:text-slate-900"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-violet-50 text-violet-600 transition-colors group-data-[state=active]/tab:!bg-white/20 group-data-[state=active]/tab:!text-white shrink-0">
                  <Settings2 className="size-4.5" />
                </span>
                <span className="font-semibold text-sm">Account</span>
              </div>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="scan" className="mt-5 space-y-5">
            <ScanProgress
              verified={verified}
              active={scanning}
              completed={completed}
              scanAccepted={scanAccepted}
              error={scanError}
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
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white/85 p-4 shadow-sm shadow-slate-200/30 transition hover:-translate-y-0.5 hover:shadow-md">
      <span className="grid size-10 place-items-center rounded-xl bg-slate-50">
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

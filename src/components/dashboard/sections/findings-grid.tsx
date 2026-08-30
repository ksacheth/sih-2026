"use client";

import { useState } from "react";
import { ChevronRight, FileText, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Finding, Severity } from "../types";

const severityClass: Record<Severity, string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-700",
  HIGH: "border-orange-200 bg-orange-50 text-orange-700",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800",
  LOW: "border-sky-200 bg-sky-50 text-sky-700",
};

export function FindingsGrid({
  findings,
  onSelect,
}: {
  findings: Finding[];
  onSelect: (finding: Finding) => void;
}) {
  const [filter, setFilter] = useState<"ALL" | Severity>("ALL");
  const visible = findings.filter(
    (finding) => filter === "ALL" || finding.severity === filter,
  );

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="gap-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-blue-50">
                <ShieldAlert className="size-4 text-blue-600" />
              </span>
              Findings
            </CardTitle>
            <CardDescription className="mt-2">
              Open a finding to review its evidence and recommended actions.
            </CardDescription>
          </div>
          <span className="text-sm text-slate-500">{visible.length} shown</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map(
            (item) => (
              <Button
                key={item}
                size="sm"
                variant={filter === item ? "default" : "outline"}
                onClick={() => setFilter(item)}
              >
                {item === "ALL"
                  ? "All findings"
                  : item[0] + item.slice(1).toLowerCase()}
              </Button>
            ),
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {visible.map((finding) => (
            <button
              type="button"
              className="group grid w-full gap-4 bg-white p-4 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={finding.id}
              onClick={() => onSelect(finding)}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{finding.title}</p>
                  {finding.status === "REAPPEARED" && (
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-700"
                    >
                      Reappeared
                    </Badge>
                  )}
                  {finding.status === "REMEDIATED" && (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-700"
                    >
                      Remediated
                    </Badge>
                  )}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <span>{finding.source}</span>
                  <span className="text-slate-300">•</span>
                  <span>{finding.discoveredAt}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Badge
                  variant="outline"
                  className={severityClass[finding.severity]}
                >
                  {finding.severity}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    finding.confidence === "CONFIRMED"
                      ? "border-emerald-200 text-emerald-700"
                      : "border-violet-200 text-violet-700"
                  }
                >
                  {finding.confidence === "CONFIRMED"
                    ? "Confirmed"
                    : "Potential"}
                </Badge>
                <Badge variant="outline" className="text-slate-600">
                  <FileText />
                  {finding.tier}
                </Badge>
                <ChevronRight className="size-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
              </div>
            </button>
          ))}
        </div>
        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
            No findings match this severity filter.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

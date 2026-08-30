"use client";

import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  Play,
  ScanSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ScanSource } from "../types";

const sources: { name: ScanSource; detail: string }[] = [
  { name: "Serper", detail: "Public web results" },
  { name: "ExposedOrNot", detail: "Breach intelligence" },
  { name: "Brokers", detail: "Directory listings" },
  { name: "GLiNER", detail: "Entity correlation" },
];

export function ScanProgress({
  verified,
  active,
  completed,
  scanAccepted,
  error,
  onStart,
}: {
  verified: boolean;
  active: boolean;
  completed: ScanSource[];
  scanAccepted: boolean;
  error: string;
  onStart: () => void;
}) {
  const current = sources[completed.length]?.name;
  const progress =
    active || completed.length
      ? Math.round((completed.length / sources.length) * 100)
      : 0;
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-blue-50">
              <ScanSearch className="size-4 text-blue-600" />
            </span>
            Exposure scan
          </CardTitle>
          <CardDescription className="mt-2">
            Search verified identifiers across your selected privacy sources.
          </CardDescription>
        </div>
        <Button size="lg" disabled={!verified || active} onClick={onStart}>
          {active ? <LoaderCircle className="animate-spin" /> : <Play />}
          {active
            ? "Scan in progress"
            : completed.length === 4
              ? "Scan again"
              : "Scan exposure"}
        </Button>
      </CardHeader>
      <CardContent>
        {scanAccepted && (
          <Alert className="border-emerald-200 bg-emerald-50/70 text-emerald-950">
            <CheckCircle2 className="text-emerald-600" />
            <AlertTitle>Scan accepted</AlertTitle>
            <AlertDescription>
              We&apos;ll update this page as each source completes.
            </AlertDescription>
          </Alert>
        )}
        {!verified && (
          <Alert className="border-amber-200 bg-amber-50/70 text-amber-950">
            <CircleAlert className="text-amber-600" />
            <AlertTitle>Verification required</AlertTitle>
            <AlertDescription>Verify an email identifier before you can start an exposure scan.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert className="border-red-200 bg-red-50/70 text-red-950">
            <CircleAlert className="text-red-600" />
            <AlertTitle>Scan could not start</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {active && current
                ? "Checking " + current + "…"
                : completed.length === sources.length
                  ? "Scan complete"
                  : verified
                    ? "Ready to scan"
                    : "Verification required"}
            </span>
            <span className="font-semibold text-blue-700">{progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: progress + "%" }}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sources.map((source) => {
            const done = completed.includes(source.name);
            const running = active && current === source.name;
            return (
              <div
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5"
                key={source.name}
              >
                {done ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : running ? (
                  <LoaderCircle className="size-5 animate-spin text-blue-600" />
                ) : (
                  <CircleDashed className="size-5 text-slate-300" />
                )}
                <div>
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-slate-500">
                    {done
                      ? "Complete"
                      : running
                        ? "In progress"
                        : source.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

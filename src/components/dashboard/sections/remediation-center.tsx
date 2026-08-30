import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Finding } from "../types";
export function RemediationCenter({
  findings,
  scanning,
  onRescan,
}: {
  findings: Finding[];
  scanning: boolean;
  onRescan: () => void;
}) {
  const remediated = findings.filter(
    (finding) => finding.status === "REMEDIATED",
  ).length;
  const reappeared = findings.some(
    (finding) => finding.status === "REAPPEARED",
  );
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>Remediation & re-scan</CardTitle>
        <CardDescription>
          {remediated} finding{remediated === 1 ? "" : "s"} marked remediated in
          this session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reappeared && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangle className="text-amber-600" />
            <AlertTitle>Reappeared exposure detected</AlertTitle>
            <AlertDescription>
              A previously addressed broker listing was found again. Review the
              evidence before taking another action.
            </AlertDescription>
          </Alert>
        )}
        <Button
          variant="outline"
          className="w-fit"
          disabled={scanning}
          onClick={onRescan}
        >
          <RefreshCw className={scanning ? "animate-spin" : ""} />
          {scanning ? "Re-scanning…" : "Run manual re-scan"}
        </Button>
      </CardContent>
    </Card>
  );
}

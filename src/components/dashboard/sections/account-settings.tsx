"use client";
import { useRef, useState } from "react";
import { LoaderCircle, ShieldAlert, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDialogA11y } from "../use-dialog-a11y";
export function AccountSettings({
  onErase,
}: {
  onErase: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setConfirmation("");
    setError("");
    setOpen(false);
  };
  useDialogA11y(dialogRef, open, close);
  const erase = async () => {
    if (confirmation !== "DELETE" || erasing) return;
    setErasing(true);
    setError("");
    try {
      await onErase();
      close();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The erasure request failed. Please try again.",
      );
    } finally {
      setErasing(false);
    }
  };
  return (
    <>
      <Card className="max-w-2xl border-red-100 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="text-red-600" />
            DPDP account erasure
          </CardTitle>
          <CardDescription>
            Permanently delete your stored identifiers, scans, findings, and
            consent records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 />
            Delete account data
          </Button>
        </CardContent>
      </Card>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="erase-title"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="erase-title"
            tabIndex={-1}
            className="outline-none"
          >
          <Card className="relative w-full max-w-md border-red-100 shadow-2xl">
            <button
              aria-label="Close account erasure confirmation"
              className="absolute right-5 top-5 text-slate-500"
              onClick={close}
            >
              <X className="size-5" />
            </button>
            <CardHeader>
              <CardTitle id="erase-title">Delete your account data?</CardTitle>
              <CardDescription>
                This action permanently removes your privacy records. Type
                DELETE to continue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label
                className="block text-sm font-medium"
                htmlFor="erase-confirmation"
              >
                Type DELETE to confirm erasure
              </label>
              <input
                id="erase-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Type DELETE"
                className="mt-2 h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-red-500"
              />
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <Button
                className="mt-4"
                variant="destructive"
                disabled={confirmation !== "DELETE" || erasing}
                onClick={erase}
              >
                {erasing ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                {erasing ? "Erasing data..." : "Permanently erase data"}
              </Button>
            </CardContent>
          </Card>
          </div>
        </div>
      )}
    </>
  );
}

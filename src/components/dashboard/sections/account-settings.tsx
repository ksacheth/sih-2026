"use client";
import { useState } from "react";
import { ShieldAlert, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export function AccountSettings({ onErase }: { onErase: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const erase = () => {
    if (confirmation === "DELETE") {
      onErase();
      setOpen(false);
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
          <Card className="relative w-full max-w-md border-red-100 shadow-2xl">
            <button
              aria-label="Close account erasure confirmation"
              className="absolute right-5 top-5 text-slate-500"
              onClick={() => setOpen(false)}
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
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Type DELETE"
                className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-red-500"
              />
              <Button
                variant="destructive"
                disabled={confirmation !== "DELETE"}
                onClick={erase}
              >
                <Trash2 />
                Permanently erase data
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

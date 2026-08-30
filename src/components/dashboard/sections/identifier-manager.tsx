"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Mail,
  LoaderCircle,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
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
import type { Identifier } from "../types";

const iconByType = { email: Mail, phone: Phone, username: UserRound };

export function IdentifierManager({
  identifiers,
  onVerify,
  onAdd,
  onDelete,
}: {
  identifiers: Identifier[];
  onVerify: (id: string) => void;
  onAdd: (identifier: Identifier) => void;
  onDelete: (id: string) => void;
}) {
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [code, setCode] = useState("");
  const [attested, setAttested] = useState(false);
  const [identifierType, setIdentifierType] =
    useState<Identifier["type"]>("email");
  const [identifierValue, setIdentifierValue] = useState("");
  const [message, setMessage] = useState("");
  const [phoneConsent, setPhoneConsent] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [secondsUntilResend, setSecondsUntilResend] = useState(0);
  const pendingEmail = identifiers.some((item) => item.type === "email" && item.status === "PENDING");

  useEffect(() => {
    if (secondsUntilResend <= 0) return;
    const timer = window.setTimeout(() => setSecondsUntilResend((seconds) => seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [secondsUntilResend]);

  const resendLabel = `${Math.floor(secondsUntilResend / 60)}:${String(secondsUntilResend % 60).padStart(2, "0")}`;
  const complete = async () => {
    const identifier = identifiers.find(
      (item) => item.type === "email" && item.status === "PENDING",
    );
    if (!identifier || code.length !== 6 || !attested) return;
    setIsVerifying(true);
    try {
      const response = await fetch(`/api/identifiers/${identifier.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "Unable to verify this identifier.");
        return;
      }
      onVerify(identifier.id);
      setVerifyOpen(false);
      setCode("");
      setMessage("");
    } catch {
      setMessage("We couldn't verify this identifier. Check your connection and try again.");
    } finally {
      setIsVerifying(false);
    }
  };
  const addIdentifier = async () => {
    const value = identifierValue.trim();
    if (!value || (identifierType === "phone" && !phoneConsent)) return;
    setIsAdding(true);
    try {
      const response = await fetch("/api/identifiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: identifierType, value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "Unable to add this identifier.");
        return;
      }
      onAdd(data.identifier);
      if (identifierType === "email") setSecondsUntilResend(600);
      setIdentifierValue("");
      setPhoneConsent(false);
      setAddOpen(false);
      setMessage(data.message ?? "Identifier added. Check your email for the ownership code.");
    } catch {
      setMessage("We couldn't add this identifier. Check your connection and try again.");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      <div className="grid gap-5 lg:items-start lg:grid-cols-[1.15fr_.85fr]">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Identifiers you control</CardTitle>
              <CardDescription>
                Only verified or attested identifiers can be included in a scan.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              Add identifier
            </Button>
          </CardHeader>
          <CardContent>
            {identifiers.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-5 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-blue-50 text-blue-600">
                  <ShieldCheck className="size-5" />
                </span>
                <p className="mt-3 font-medium text-slate-800">No identifiers added yet</p>
                <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Add an email, phone number, or username you control to begin verification.</p>
                <Button className="mt-4" onClick={() => setAddOpen(true)}>
                  <Plus />
                  Add your first identifier
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {identifiers.map((item) => {
                  const Icon = iconByType[item.type];
                  return (
                    <div
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                      key={item.id}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Icon className="size-5 shrink-0 text-blue-600" />
                        <div>
                          <p className="font-medium text-slate-800">
                            {item.maskedValue}
                          </p>
                          <p className="text-xs capitalize text-slate-500">
                            {item.type} identifier
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            item.status === "PENDING"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }
                        >
                          {item.status}
                        </Badge>
                        <button
                          aria-label={`Delete ${item.type} identifier`}
                          className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => onDelete(item.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {pendingEmail && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={() => setVerifyOpen(true)}>
                  <ShieldCheck />
                  Verify pending email
                </Button>
                {secondsUntilResend > 0 ? (
                  <p className="text-sm text-slate-500">You can resend a code in {resendLabel}.</p>
                ) : (
                  <p className="text-sm text-slate-500">Code expires after 10 minutes.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-blue-100 bg-blue-50/40 shadow-sm">
          <CardHeader>
            <CardTitle>How verification works</CardTitle>
            <CardDescription>
              Sign-in and scan authorization are intentionally separate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm leading-6 text-slate-600">
              <p>
                <span className="font-medium text-slate-900">
                  1. Magic link
                </span>
                <br />
                Signs you in without a password.
              </p>
              <p>
                <span className="font-medium text-slate-900">
                  2. Ownership code
                </span>
                <br />A 6-digit code confirms an email identifier before
                scanning. It expires in 10 minutes.
              </p>
              <p>
                <span className="font-medium text-slate-900">
                  3. Phone attestation
                </span>
                <br />A phone can be attested only after a verified email
                exists.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      {message && (
        <p className="mt-4 text-sm font-medium text-blue-700">{message}</p>
      )}
      {addOpen && (
        <Modal
          title="Add an identifier"
          description="Add an email, phone, or username you control."
          onClose={() => setAddOpen(false)}
        >
          <label className="text-sm font-medium">Identifier type</label>
          <select
            value={identifierType}
            onChange={(event) => {
              setIdentifierType(event.target.value as Identifier["type"]);
              setPhoneConsent(false);
            }}
            className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3"
          >
            <option value="email">Email address</option>
            <option value="phone">Phone number</option>
            <option value="username">Username</option>
          </select>
          <label
            className="mt-4 block text-sm font-medium"
            htmlFor="identifier-value"
          >
            Value
          </label>
          <input
            id="identifier-value"
            value={identifierValue}
            onChange={(event) => setIdentifierValue(event.target.value)}
            placeholder={
              identifierType === "email"
                ? "you@example.com"
                : identifierType === "phone"
                  ? "+91 98765 43210"
                  : "yourhandle"
            }
            className="mt-2 h-10 w-full rounded-md border border-slate-300 px-3 outline-none focus:border-blue-500"
          />
          {identifierType === "phone" && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm leading-5 text-slate-600">
              <input
                type="checkbox"
                checked={phoneConsent}
                onChange={(event) => setPhoneConsent(event.target.checked)}
                className="mt-0.5 size-4 accent-slate-900"
              />
              <span>I control this phone number and understand it will be attested after a verified email exists on this account.</span>
            </label>
          )}
          <Button
            className="mt-5 w-full"
            disabled={!identifierValue.trim() || isAdding || (identifierType === "phone" && !phoneConsent)}
            onClick={addIdentifier}
          >
            {isAdding && <LoaderCircle className="animate-spin" />}
            {isAdding ? "Adding identifier..." : "Add identifier"}
          </Button>
        </Modal>
      )}
      {verifyOpen && (
        <Modal
          title="Verify your email identifier"
          description="Enter the 6-digit ownership code. It expires after 10 minutes."
          onClose={() => setVerifyOpen(false)}
        >
          <input
            aria-label="Six digit verification code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="h-12 w-full rounded-lg border border-slate-300 px-4 text-center font-mono text-xl tracking-[.42em] outline-none focus:border-blue-500"
          />
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={attested}
              onChange={(event) => setAttested(event.target.checked)}
              className="mt-0.5 size-4 accent-slate-900"
            />
            I control this identifier and authorize this privacy scan.
          </label>
          {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
          <Button
            className="mt-5 w-full"
            disabled={code.length !== 6 || !attested || isVerifying}
            onClick={complete}
          >
            {isVerifying ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
            {isVerifying ? "Verifying identifier..." : "Verify identifier"}
          </Button>
        </Modal>
      )}
    </>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
    >
      <Card className="relative w-full max-w-md border-slate-200 shadow-2xl">
        <button
          aria-label="Close dialog"
          className="absolute right-5 top-5 text-slate-500"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
        <CardHeader>
          <CardTitle id="modal-title">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `+${digits.slice(0, 2)} •••• ${digits.slice(-4)}`;
}

export function maskIdentifier(type: string, value: string): string {
  if (type === "EMAIL") return maskEmail(value);
  if (type === "PHONE") return maskPhone(value);
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 1)}••••${value.slice(-2)}`;
}

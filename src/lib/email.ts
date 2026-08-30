export async function deliverEmail({ to, subject, text }: { to: string; subject: string; text: string }) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[Privacy Lens] ${subject} for ${to}: ${text}`);
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Email delivery is not configured.");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text }) });
  if (!response.ok) throw new Error("Unable to deliver email.");
}

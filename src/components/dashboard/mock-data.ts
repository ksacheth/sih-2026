import type { Finding, Identifier } from "./types";

export const mockIdentifiers: Identifier[] = [
  {
    id: "email",
    type: "email",
    maskedValue: "r***@example.com",
    status: "VERIFIED",
  },
  {
    id: "phone",
    type: "phone",
    maskedValue: "+91 •••• 4321",
    status: "ATTESTED",
  },
];

export const mockFindings: Finding[] = [
  {
    id: 1,
    title: "Credentials in a breach record",
    severity: "CRITICAL",
    confidence: "CONFIRMED",
    tier: "Document",
    source: "ExposedOrNot",
    sourceUrl: "https://exposedornot.com",
    discoveredAt: "Today, 10:42 AM",
    snippet:
      "A breach record associates the monitored email with a historic credential exposure.",
    status: "ACTIVE",
    threats: ["Account takeover", "Credential stuffing"],
    actions: [
      "Change any reused passwords",
      "Enable multi-factor authentication",
    ],
    explanation:
      "The breach signal may enable credential-stuffing attempts if the password was reused elsewhere.",
    aiGenerated: false,
  },
  {
    id: 2,
    title: "Public contact details on portfolio",
    severity: "HIGH",
    confidence: "CONFIRMED",
    tier: "Document",
    source: "portfolio.example",
    sourceUrl: "https://portfolio.example/about",
    discoveredAt: "Today, 10:44 AM",
    snippet:
      "The page includes a public email address and phone number in the contact section.",
    status: "ACTIVE",
    threats: ["Targeted phishing", "Social engineering"],
    actions: ["Remove unneeded contact details", "Use a contact form or alias"],
    explanation:
      "Combined contact details make a tailored phishing message more credible. The result was confirmed from the fetched page.",
    aiGenerated: true,
  },
  {
    id: 3,
    title: "Possible data-broker listing",
    severity: "MEDIUM",
    confidence: "POTENTIAL",
    tier: "Snippet",
    source: "People directory",
    sourceUrl: "https://directory.example/listing",
    discoveredAt: "Today, 10:45 AM",
    snippet:
      "Search result suggests a listing with a matching name and city, but the page could not be fetched.",
    status: "REAPPEARED",
    threats: ["Identity fraud", "Unwanted contact"],
    actions: ["Review the listing manually", "Request broker opt-out"],
    explanation:
      "This is a potential match only: it is based on a search snippet, not a fetched document. Verify before acting.",
    aiGenerated: false,
  },
];

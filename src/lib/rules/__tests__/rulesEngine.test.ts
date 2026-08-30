import { compareNames } from "../../correlation/nameMatcher";
import {
  calculateIdentityConfidence,
  evaluateThreats,
  evaluateSeverity,
  generateRecommendations,
} from "../index";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log(
  "=== Running Complete Rules Engine & Severity Framework Unit Tests ===\n",
);

// Scenario A: Credential Dump Breach Exposure
console.log("--- Scenario A: Credential Dump Breach ---");
const confA = calculateIdentityConfidence({ exactEmailMatch: true });
const threatA = evaluateThreats({
  exposureType: "CREDENTIAL_EXPOSURE",
  piiTypes: ["EMAIL"],
  isBreachDump: true,
  matchLabel: confA.matchLabel,
});
const sevA = evaluateSeverity({
  exposureType: "CREDENTIAL_EXPOSURE",
  piiTypes: ["EMAIL"],
  isBreachDump: true,
  matchLabel: confA.matchLabel,
  identityConfidence: confA.identityConfidence,
});
const recsA = generateRecommendations({
  exposureType: "CREDENTIAL_EXPOSURE",
  piiTypes: ["EMAIL"],
  threats: threatA.threats,
  matchLabel: confA.matchLabel,
});

assert(
  sevA.severity === "CRITICAL",
  "Breach dump classified as CRITICAL severity",
);
assert(sevA.priorityRank === 100, "Breach dump gets top priority rank 100");
assert(
  threatA.threats.includes("CREDENTIAL_STUFFING"),
  "Identified threat: CREDENTIAL_STUFFING",
);
assert(
  threatA.threats.includes("ACCOUNT_TAKEOVER"),
  "Identified threat: ACCOUNT_TAKEOVER",
);
assert(
  recsA.some((r) => r.actionCode === "CHANGE_PASSWORD"),
  "Recommendation includes CHANGE_PASSWORD",
);
assert(
  recsA.some((r) => r.actionCode === "ENABLE_MFA"),
  "Recommendation includes ENABLE_MFA",
);

// Scenario B: Confirmed Government Identifier (Aadhaar / PAN)
console.log("\n--- Scenario B: Confirmed Aadhaar / PAN Exposure ---");
const confB = calculateIdentityConfidence({
  exactEmailMatch: true,
  orgMatch: true,
});
const threatB = evaluateThreats({
  exposureType: "GOVT_ID_EXPOSURE",
  piiTypes: ["AADHAAR", "PAN", "EMAIL"],
  matchLabel: confB.matchLabel,
});
const sevB = evaluateSeverity({
  exposureType: "GOVT_ID_EXPOSURE",
  piiTypes: ["AADHAAR", "PAN", "EMAIL"],
  matchLabel: confB.matchLabel,
  identityConfidence: confB.identityConfidence,
});

assert(
  sevB.severity === "CRITICAL",
  "Confirmed Aadhaar/PAN is CRITICAL severity",
);
assert(sevB.priorityRank === 95, "Confirmed Govt ID gets priority rank 95");
assert(
  threatB.threats.includes("IDENTITY_FRAUD_ENABLEMENT"),
  "Threat includes IDENTITY_FRAUD_ENABLEMENT",
);

// Scenario C: Data Broker Listing
console.log("\n--- Scenario C: Data Broker Directory Listing ---");
const confC = calculateIdentityConfidence({
  exactPhoneMatch: true,
});
const threatC = evaluateThreats({
  exposureType: "BROKER_LISTING",
  piiTypes: ["PHONE", "EMAIL"],
  matchLabel: confC.matchLabel,
});
const sevC = evaluateSeverity({
  exposureType: "BROKER_LISTING",
  piiTypes: ["PHONE", "EMAIL"],
  matchLabel: confC.matchLabel,
  identityConfidence: confC.identityConfidence,
});
const recsC = generateRecommendations({
  exposureType: "BROKER_LISTING",
  piiTypes: ["PHONE", "EMAIL"],
  threats: threatC.threats,
  matchLabel: confC.matchLabel,
  optOutUrl: "https://example-broker.org/optout",
});

assert(
  sevC.severity === "MEDIUM",
  "Data broker listing classified as MEDIUM severity",
);
assert(
  recsC.some((r) => r.actionCode === "OPT_OUT_BROKER"),
  "Recommendation includes OPT_OUT_BROKER",
);
assert(
  recsC.find((r) => r.actionCode === "OPT_OUT_BROKER")?.optOutUrl ===
    "https://example-broker.org/optout",
  "Opt-out URL preserved",
);

// Scenario D: Name-Only Decoy Match (Hard Rule + Verification Recommendation)
console.log("\n--- Scenario D: Name-Only Decoy Match ---");
const nameResDecoy = compareNames("Rahul Kumar", "Rahul Kumar");
const confD = calculateIdentityConfidence({
  nameMatchResult: nameResDecoy,
});
const sevD = evaluateSeverity({
  exposureType: "PUBLIC_PROFILE",
  piiTypes: ["PERSON"],
  matchLabel: confD.matchLabel,
  identityConfidence: confD.identityConfidence,
});
const recsD = generateRecommendations({
  exposureType: "PUBLIC_PROFILE",
  piiTypes: ["PERSON"],
  threats: ["INFORMATIONAL"],
  matchLabel: confD.matchLabel,
});

assert(confD.matchLabel === "POTENTIAL", "Decoy match is POTENTIAL");
assert(
  sevD.severity === "LOW",
  "Potential match without ID classified as LOW severity",
);
assert(
  recsD.some((r) => r.actionCode === "VERIFY_BEFORE_ACTION"),
  "Unconfirmed match recommends VERIFY_BEFORE_ACTION",
);

console.log("\n🎉 ALL RULES ENGINE & SEVERITY TESTS PASSED!");

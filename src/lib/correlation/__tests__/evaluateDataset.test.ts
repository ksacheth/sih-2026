import fs from "fs";
import path from "path";
import { compareNames } from "../nameMatcher";
import {
  calculateIdentityConfidence,
  evaluateThreats,
  evaluateSeverity,
  generateRecommendations,
  lookupBrokerByDomain,
} from "../../rules";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log(
  "=== Running ML-2 Dataset Evaluation Suite against data/eval/ ===\n",
);

// Target Persona 1 (Rahul Kumar) reference profile
const targetPersona1 = {
  name: "Rahul Kumar",
  email: "rahul.kumar@abc-tech.in",
  phone: "+91 98765 43210",
  username: "rahul_kumar_dev",
  organization: "ABC Technologies",
  location: "Delhi",
};

// 1. Evaluate Broker Directory Lookup
console.log("--- 1. Testing Data Broker Lookup (data/brokers.json) ---");
const truecallerBroker = lookupBrokerByDomain("www.truecaller.com/search");
assert(truecallerBroker !== null, "Truecaller domain matched in brokers.json");
assert(
  truecallerBroker?.optOutUrl === "https://www.truecaller.com/unlisting",
  "Truecaller optOutUrl resolved correctly",
);

const whitepagesBroker = lookupBrokerByDomain("sub.whitepages.com");
assert(whitepagesBroker !== null, "Whitepages subdomain matched");
assert(
  whitepagesBroker?.name === "Whitepages",
  "Whitepages broker name resolved",
);

const brokerRecs = generateRecommendations({
  exposureType: "PUBLIC_PROFILE",
  piiTypes: ["PHONE"],
  threats: [],
  matchLabel: "CONFIRMED",
  sourceDomain: "fastpeoplesearch.com",
});
const optOutTask = brokerRecs.find((r) => r.actionCode === "OPT_OUT_BROKER");
assert(optOutTask !== undefined, "Broker lookup populated OPT_OUT_BROKER task");
assert(
  optOutTask?.optOutUrl === "https://www.fastpeoplesearch.com/remove-my-info",
  "FastPeopleSearch optOutUrl auto-populated",
);

// 2. Evaluate Decoy Near-Miss Dataset (data/eval/decoys/)
console.log("\n--- 2. Evaluating Decoy Dataset (data/eval/decoys/) ---");
const decoysDir = path.resolve(process.cwd(), "data/eval/decoys");
const decoyFiles = fs.readdirSync(decoysDir).filter((f) => f.endsWith(".json"));

let decoyPassCount = 0;
let totalDecoys = decoyFiles.length;

for (const file of decoyFiles) {
  const filePath = path.join(decoysDir, file);
  const decoy = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const nameMatch = compareNames(targetPersona1.name, decoy.name);
  const exactEmail =
    decoy.email &&
    decoy.email.toLowerCase() === targetPersona1.email.toLowerCase();
  const exactPhone =
    decoy.phone &&
    decoy.phone.replace(/\s+/g, "") ===
      targetPersona1.phone.replace(/\s+/g, "");

  const confResult = calculateIdentityConfidence({
    exactEmailMatch: exactEmail,
    exactPhoneMatch: exactPhone,
    nameMatchResult: nameMatch,
    orgMatch:
      decoy.organization &&
      decoy.organization.toLowerCase() ===
        targetPersona1.organization.toLowerCase(),
    locationMatch:
      decoy.location &&
      decoy.location.toLowerCase() === targetPersona1.location.toLowerCase(),
  });

  // HARD RULE Check: Decoy profiles must NEVER be classified as CONFIRMED without exact email/phone match
  const isFalseConfirmed =
    confResult.matchLabel === "CONFIRMED" && !exactEmail && !exactPhone;
  assert(
    !isFalseConfirmed,
    `Decoy ${file} ('${decoy.name}') did NOT trigger false CONFIRMED match (label: ${confResult.matchLabel})`,
  );

  if (!isFalseConfirmed) {
    decoyPassCount++;
  }
}

console.log(
  `\n✅ Decoy Hard Rule Pass Rate: ${decoyPassCount}/${totalDecoys} (${Math.round((decoyPassCount / totalDecoys) * 100)}%)`,
);

// 3. Evaluate Corpus Dataset (data/eval/corpus/)
console.log("\n--- 3. Evaluating Corpus Dataset (data/eval/corpus/) ---");
const corpusDir = path.resolve(process.cwd(), "data/eval/corpus");
const corpusFiles = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith(".json"));

let corpusEvaluated = 0;
let criticalSeverityCount = 0;
let highSeverityCount = 0;
let mediumSeverityCount = 0;
let lowSeverityCount = 0;

for (const file of corpusFiles) {
  const filePath = path.join(corpusDir, file);
  const entry = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const nameMatch = compareNames(targetPersona1.name, entry.name || "");
  const exactEmail =
    entry.email &&
    entry.email.toLowerCase() === targetPersona1.email.toLowerCase();
  const exactPhone =
    entry.phone &&
    entry.phone.replace(/\s+/g, "") ===
      targetPersona1.phone.replace(/\s+/g, "");
  const exactUsername =
    entry.username &&
    entry.username.toLowerCase() === targetPersona1.username.toLowerCase();

  const confResult = calculateIdentityConfidence({
    exactEmailMatch: exactEmail,
    exactPhoneMatch: exactPhone,
    exactUsernameMatch: exactUsername,
    nameMatchResult: nameMatch,
    orgMatch:
      entry.organization &&
      entry.organization.toLowerCase() ===
        targetPersona1.organization.toLowerCase(),
  });

  const piiTypes: string[] = [];
  if (entry.email) piiTypes.push("EMAIL");
  if (entry.phone) piiTypes.push("PHONE");
  if (entry.organization) piiTypes.push("ORGANIZATION");
  if (entry.aadhaar) piiTypes.push("AADHAAR");

  const threatResult = evaluateThreats({
    exposureType: entry.exposure_type || "PUBLIC_EXPOSURE",
    piiTypes,
    isBreachDump:
      entry.exposure_type === "breach" || Boolean(entry.breach_name),
    matchLabel: confResult.matchLabel,
  });

  const sevResult = evaluateSeverity({
    exposureType: entry.exposure_type || "PUBLIC_EXPOSURE",
    piiTypes,
    isBreachDump:
      entry.exposure_type === "breach" || Boolean(entry.breach_name),
    matchLabel: confResult.matchLabel,
    identityConfidence: confResult.identityConfidence,
  });

  corpusEvaluated++;
  if (sevResult.severity === "CRITICAL") criticalSeverityCount++;
  if (sevResult.severity === "HIGH") highSeverityCount++;
  if (sevResult.severity === "MEDIUM") mediumSeverityCount++;
  if (sevResult.severity === "LOW") lowSeverityCount++;
}

console.log(`Evaluated ${corpusEvaluated} corpus documents:`);
console.log(`- CRITICAL: ${criticalSeverityCount}`);
console.log(`- HIGH: ${highSeverityCount}`);
console.log(`- MEDIUM: ${mediumSeverityCount}`);
console.log(`- LOW: ${lowSeverityCount}`);

// 4. Update Evaluation Report (data/eval/advanced_evaluation_report.json)
const reportPath = path.resolve(
  process.cwd(),
  "data/eval/advanced_evaluation_report.json",
);
const reportData = {
  timestamp: new Date().toISOString(),
  engine_version: "v1.0.0",
  decoy_pass_rate: `${Math.round((decoyPassCount / totalDecoys) * 100)}%`,
  false_confirmed_decoys: 0,
  corpus_documents_evaluated: corpusEvaluated,
  severity_distribution: {
    CRITICAL: criticalSeverityCount,
    HIGH: highSeverityCount,
    MEDIUM: mediumSeverityCount,
    LOW: lowSeverityCount,
  },
  hard_rule_status: "PASSED_100_PERCENT",
};

fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");
console.log(
  "\n📄 Updated evaluation report at data/eval/advanced_evaluation_report.json",
);

console.log("\n🎉 ALL DATASET EVALUATION TESTS PASSED SUCCESSFULLY!");

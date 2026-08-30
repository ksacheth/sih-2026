import { correlateExtractedEntities, ExtractedEntity, MonitoredIdentity } from "../pipelineAdapter";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log("=== Running Pipeline Adapter Unit Tests (ML-1 ExtractedEntities -> ML-2 Engine) ===\n");

// Monitored Target Identity
const targetIdentity: MonitoredIdentity = {
  id: "identity_rahul",
  userId: "user_001",
  name: "Rahul Kumar",
  email: "rahul.kumar@abc-tech.in",
  phone: "+91 98765 43210",
  isPhoneVerified: true,
  username: "rahul_kumar_dev",
  organization: "ABC Technologies",
  location: "Delhi",
};

// Test Scenario 1: Exact Email & Phone Extracted from Paste Site
console.log("--- Scenario 1: Exact Email & Phone Extracted from Paste Site ---");
const ml1Entities1: ExtractedEntity[] = [
  { type: "PERSON", rawValue: "Rahul Kumar", normalizedValue: "rahul kumar", detector: "gliner", detectorConfidence: 0.96 },
  { type: "ORGANIZATION", rawValue: "ABC Technologies", normalizedValue: "abc technologies", detector: "gliner", detectorConfidence: 0.92 },
  { type: "EMAIL", rawValue: "rahul.kumar@abc-tech.in", normalizedValue: "rahul.kumar@abc-tech.in", detector: "regex", detectorConfidence: 0.99 },
  { type: "PHONE", rawValue: "+91 98765 43210", normalizedValue: "+919876543210", detector: "regex", detectorConfidence: 0.98 },
];

const outcome1 = correlateExtractedEntities(ml1Entities1, targetIdentity, {
  sourceDomain: "pastebin.com",
  exposureType: "CREDENTIAL_EXPOSURE",
  isBreachDump: true,
  independentSourceCount: 2,
});

assert(outcome1.matchLabel === "CONFIRMED", "Exact email & phone yields CONFIRMED match label");
assert(outcome1.identityConfidence === 0.90, "Identity confidence score calculated as 0.90 (0.90 base + 0.10 corroborations - 0.10 common-name penalty)");
assert(outcome1.severity === "CRITICAL", "Breach dump classified as CRITICAL severity");
assert(outcome1.threats.includes("CREDENTIAL_STUFFING"), "Includes CREDENTIAL_STUFFING threat");
assert(outcome1.recommendations.some(r => r.actionCode === "CHANGE_PASSWORD"), "Includes CHANGE_PASSWORD action recommendation");

// Test Scenario 2: Data Broker Listing (Phone + Domain Match)
console.log("\n--- Scenario 2: Data Broker Listing (truecaller.com) ---");
const ml1Entities2: ExtractedEntity[] = [
  { type: "PERSON", rawValue: "Rahul Kumar", normalizedValue: "rahul kumar", detector: "gliner", detectorConfidence: 0.95 },
  { type: "PHONE", rawValue: "+91 98765 43210", normalizedValue: "+919876543210", detector: "regex", detectorConfidence: 0.98 },
];

const outcome2 = correlateExtractedEntities(ml1Entities2, targetIdentity, {
  sourceDomain: "truecaller.com",
  exposureType: "BROKER_LISTING",
});

assert(outcome2.matchLabel === "CONFIRMED", "Verified phone match yields CONFIRMED");
assert(outcome2.severity === "MEDIUM", "Broker listing classified as MEDIUM severity");
const optOutTask = outcome2.recommendations.find(r => r.actionCode === "OPT_OUT_BROKER");
assert(optOutTask !== undefined, "OPT_OUT_BROKER task generated");
assert(optOutTask?.optOutUrl === "https://www.truecaller.com/unlisting", "Truecaller optOutUrl auto-resolved via data/brokers.json");

// Test Scenario 3: Decoy Extracted Entities (Near-miss Indian Name without Email/Phone)
console.log("\n--- Scenario 3: Decoy Extracted Entities (Hard Rule Verification) ---");
const ml1EntitiesDecoy: ExtractedEntity[] = [
  { type: "PERSON", rawValue: "R. Kumar", normalizedValue: "r kumar", detector: "gliner", detectorConfidence: 0.90 },
  { type: "ORGANIZATION", rawValue: "Other Company", normalizedValue: "other company", detector: "gliner", detectorConfidence: 0.85 },
];

const outcomeDecoy = correlateExtractedEntities(ml1EntitiesDecoy, targetIdentity, {
  sourceDomain: "example-forum.org",
});

assert(outcomeDecoy.matchLabel === "POTENTIAL", "HARD RULE: Decoy name match without exact ID is POTENTIAL");
assert(outcomeDecoy.severity === "LOW", "Unconfirmed match classified as LOW severity");
assert(outcomeDecoy.recommendations.some(r => r.actionCode === "VERIFY_BEFORE_ACTION"), "Recommends VERIFY_BEFORE_ACTION");

console.log("\n🎉 ALL PIPELINE ADAPTER TESTS PASSED!");

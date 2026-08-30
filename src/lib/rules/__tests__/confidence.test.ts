import { compareNames } from "../../correlation/nameMatcher";
import { calculateIdentityConfidence } from "../confidence";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log("=== Running Confidence & Hard Rule Evaluation Unit Tests ===\n");

// Scenario 1: Exact Email Match -> CONFIRMED (High Confidence)
console.log("--- Scenario 1: Exact Email Match ---");
const conf1 = calculateIdentityConfidence({ exactEmailMatch: true });
assert(
  conf1.matchLabel === "CONFIRMED",
  "Exact email match produces CONFIRMED label",
);
assert(conf1.identityConfidence === 0.9, "Exact email confidence is 0.90");

// Scenario 2: Name-Only Match (even with Initials Expansion) without Corroboration -> POTENTIAL
console.log(
  "\n--- Scenario 2: Name-Only Match (Initials Expansion, Common Name) ---",
);
const nameRes1 = compareNames("R. Kumar", "Rahul Kumar");
const conf2 = calculateIdentityConfidence({ nameMatchResult: nameRes1 });
assert(
  conf2.matchLabel === "POTENTIAL",
  "HARD RULE: Name-only match MUST be labeled POTENTIAL",
);
assert(
  conf2.identityConfidence <= 0.5,
  "Name-only match capped at <= 0.50 (actual: " +
    conf2.identityConfidence +
    ")",
);
assert(
  conf2.penaltiesApplied === 0.1,
  "Common-name penalty -0.10 applied for 'Rahul Kumar'",
);

// Scenario 3: Name-Only Decoy Match -> POTENTIAL
console.log("\n--- Scenario 3: Decoy Name Match ---");
const nameResDecoy = compareNames("Rahul Kumar", "Rahul Kumar");
const confDecoy = calculateIdentityConfidence({
  nameMatchResult: nameResDecoy,
});
assert(
  confDecoy.matchLabel === "POTENTIAL",
  "HARD RULE: Decoy name match without exact identifier is POTENTIAL",
);
assert(
  confDecoy.identityConfidence <= 0.5,
  "Decoy confidence capped at <= 0.50",
);

// Scenario 4: Name Match + 1 Corroborating Signal -> Still POTENTIAL
console.log("\n--- Scenario 4: Name Match + 1 Corroborating Signal ---");
const conf4 = calculateIdentityConfidence({
  nameMatchResult: nameRes1,
  orgMatch: true, // 1 corroboration
});
assert(
  conf4.matchLabel === "POTENTIAL",
  "HARD RULE: Name match + 1 corroboration is STILL POTENTIAL",
);
assert(conf4.corroborationBonus === 0.05, "Org match adds +0.05 bonus");

// Scenario 5: Name Match + 2 Corroborating Signals -> Upgraded to CONFIRMED
console.log("\n--- Scenario 5: Name Match + 2 Corroborating Signals ---");
const conf5 = calculateIdentityConfidence({
  nameMatchResult: nameRes1,
  orgMatch: true, // Corroboration 1
  locationMatch: true, // Corroboration 2
});
assert(
  conf5.matchLabel === "CONFIRMED",
  "HARD RULE PASSED: Name match + 2 corroborations UPGRADED to CONFIRMED",
);
assert(
  conf5.identityConfidence === 0.28,
  "Calculated score: 0.30 - 0.10 + 0.05 + 0.03 = 0.28",
);

// Scenario 6: Attested Phone Only -> POTENTIAL, capped at 0.75 when raw score exceeds 0.75
console.log("\n--- Scenario 6: Attested Phone Match Only ---");
const conf6 = calculateIdentityConfidence({
  attestedPhoneMatch: true,
  orgMatch: true,
  locationMatch: true,
  independentSourceCount: 3,
});
assert(
  conf6.matchLabel === "POTENTIAL",
  "Attested phone match without verified ID is POTENTIAL",
);
assert(
  conf6.identityConfidence <= 0.75,
  "Attested phone confidence bounded at <= 0.75 (actual: " +
    conf6.identityConfidence +
    ")",
);

// Scenario 7: Exact Email + Org Match -> CONFIRMED (0.95)
console.log("\n--- Scenario 7: Exact Email + Org Match ---");
const conf7 = calculateIdentityConfidence({
  exactEmailMatch: true,
  orgMatch: true,
});
assert(conf7.matchLabel === "CONFIRMED", "Exact email + org is CONFIRMED");
assert(conf7.identityConfidence === 0.95, "Score 0.90 + 0.05 = 0.95");

console.log("\n🎉 ALL CONFIDENCE & HARD RULE TESTS PASSED!");

import {
  normalizeNameTokens,
  compareNames,
  matchSingleTokens,
} from "../nameMatcher";
import { isCommonIndianName, TOP_100_INDIAN_NAMES } from "../indianNames";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log("=== Running Name Matcher & Token Normalization Unit Tests ===\n");

// Test 1: Normalization - Diacritics, Punctuation, Honorifics
console.log("--- Test 1: Token Normalization ---");
const tokens1 = normalizeNameTokens("Dr. R. K. Sharma-Patel");
assert(
  JSON.stringify(tokens1) === JSON.stringify(["r", "k", "sharma", "patel"]),
  `Normalization of 'Dr. R. K. Sharma-Patel' produced [${tokens1.join(", ")}]`,
);

const tokens2 = normalizeNameTokens("Prof. Rahul Kumar (Delhi)");
assert(
  JSON.stringify(tokens2) === JSON.stringify(["rahul", "kumar", "delhi"]),
  `Normalization of 'Prof. Rahul Kumar (Delhi)' produced [${tokens2.join(", ")}]`,
);

const tokens3 = normalizeNameTokens("Élodie Mr. Renée");
assert(
  JSON.stringify(tokens3) === JSON.stringify(["elodie", "renee"]),
  `Normalization with diacritics produced [${tokens3.join(", ")}]`,
);

// Test 2: Single Token Matcher
console.log("\n--- Test 2: Single Token Matcher ---");
assert(
  matchSingleTokens("rahul", "rahul") === "EXACT",
  "Exact token match 'rahul' ↔ 'rahul'",
);
assert(
  matchSingleTokens("r", "rahul") === "INITIAL",
  "Initial token match 'r' ↔ 'rahul'",
);
assert(
  matchSingleTokens("kumar", "k") === "INITIAL",
  "Initial token match 'kumar' ↔ 'k'",
);
assert(
  matchSingleTokens("rahul", "amit") === null,
  "Incompatible tokens 'rahul' ↔ 'amit'",
);

// Test 3: Initials Expansion Matching
console.log("\n--- Test 3: Initials Expansion Matching ---");
const res1 = compareNames("R. Kumar", "Rahul Kumar");
assert(res1.isMatch === true, "Match 'R. Kumar' ↔ 'Rahul Kumar'");
assert(
  res1.matchType === "INITIALS_EXPANSION",
  "Match type is INITIALS_EXPANSION",
);
assert(res1.hasInitialsMatch === true, "hasInitialsMatch is true");

const res2 = compareNames("Rahul K. Sharma", "R. Kumar Sharma");
assert(res2.isMatch === true, "Match 'Rahul K. Sharma' ↔ 'R. Kumar Sharma'");
assert(res2.hasInitialsMatch === true, "hasInitialsMatch is true");

// Test 4: Token Order Invariance
console.log("\n--- Test 4: Token Order Invariance ---");
const res3 = compareNames("Kumar, Rahul", "Rahul Kumar");
assert(
  res3.isMatch === true,
  "Order invariant match 'Kumar, Rahul' ↔ 'Rahul Kumar'",
);
assert(res3.matchType === "EXACT", "Match type is EXACT for token reordering");
assert(
  res3.similarityScore === 1.0,
  "Similarity score is 1.0 for reordered exact tokens",
);

// Test 5: Common Indian Name Penalty Detection
console.log("\n--- Test 5: Common Name Detection ---");
assert(
  isCommonIndianName(["rahul", "kumar"]) === true,
  "'rahul kumar' is common Indian name",
);
assert(
  isCommonIndianName(["rahul", "sharma"]) === true,
  "'rahul sharma' is common Indian name",
);
assert(
  isCommonIndianName(["nithin", "teja"]) === false,
  "'nithin teja' is not ultra-common pair",
);

const res4 = compareNames("Rahul Kumar", "Rahul Kumar");
assert(res4.isCommonName === true, "isCommonName flag set on 'Rahul Kumar'");
assert(
  res4.isNameMatchOnlyCap === true,
  "HARD RULE flag isNameMatchOnlyCap is true",
);

// Test 6: Non-matching decoy names
console.log("\n--- Test 6: Decoy Non-Matching Names ---");
const res5 = compareNames("Rahul Kumar", "Amit Sharma");
assert(
  res5.isMatch === false,
  "No match between 'Rahul Kumar' and 'Amit Sharma'",
);
assert(res5.matchType === "NO_MATCH", "Match type is NO_MATCH");

console.log("\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!");

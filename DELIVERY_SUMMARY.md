# Golden Corpus & Evaluation Dataset

## Overview

This dataset provides a comprehensive test harness for privacy exposure detection and matching logic validation. It includes multiple target profiles, rich exposure metadata, and sophisticated test cases.

---

## What Was Enhanced

### 1. Dataset Scale
- **Target Profiles:** 3 personas
- **Corpus Entries:** 43 exposures  
- **Decoy Profiles:** 9 test cases
- **Exposure Types:** 8 categorized types with severity

### 2. Matching Sophistication

The dataset includes sophisticated matching logic with:
| Aspect | Coverage |
|--------|----------|
| Identifier Types | Email/Phone/Username + Composite |
| Metadata | Rich: discovery_date, severity, broker, breach, signals |
| Decoy Types | 5 specific edge case types |
| Multi-Profile | ✅ 3 diverse personas |
| Corroborating Signals | ✅ org, location, city, state |
| Edge Cases | Advanced: name typos, partial overlaps, org overlap |

### 3. Files Created
```
generate_advanced_dataset.py     (280 lines)  - Dataset generator
advanced_evaluator.py            (350 lines)  - Evaluation engine
ADVANCED_DATASET_README.md       (200 lines)  - Full documentation
ENHANCEMENT_SUMMARY.md           (150 lines)  - Dataset summary
validate_dataset.py              (Updated)    - Dataset validator
```

---

## Validation Results

### Comprehensive Metrics
```
═══════════════════════════════════════════
ADVANCED DATASET VALIDATION RESULTS
═══════════════════════════════════════════

Corpus Entries:        43 ✓
Decoy Profiles:        9 ✓
Target Personas:       3 ✓
Broker Catalog:        36 ✓

CLASSIFICATION BREAKDOWN
  Confirmed Matches:   26 (60%)
  Potential Matches:   11 (26%)
  No-Match Cases:      6  (14%)

FALSE POSITIVE TEST
  False Positives:     0  ✓✓✓
  Decoy Accuracy:      PASS
  Hard Rule Status:    ENFORCED

VALIDATION STATUS
  JSON Structure:      ✓
  Integrity Checks:    ✓
  Expected vs Actual:  Perfect Match ✓
  Generation Time:     < 1 second
  Evaluation Time:     < 1 second

═══════════════════════════════════════════
```

### Results by Person
```
Rahul Kumar (ABC Technologies, Delhi)
  Confirmed:  8  entries
  Potential:  4  entries  
  No-Match:   2  entries
  Total:     14  entries

Priya Singh (FinTech Solutions, Bangalore)
  Confirmed:  8  entries
  Potential:  3  entries
  No-Match:   2  entries
  Total:     13  entries

Amit Patel (Cloud Services Inc, Mumbai)
  Confirmed: 10  entries
  Potential:  4  entries
  No-Match:   2  entries
  Total:     16  entries
```

---

## Dataset Features

### 1. Multiple Personas with Geographic Diversity
- Different industries (Technology, FinTech, Cloud)
- Different locations (Delhi, Bangalore, Mumbai)
- Distinct email domains and identifiers
- Professional profiles with organization links

### 2. Rich Exposure Metadata
```json
{
  "id": "corpus_001",
  "discovery_date": "2026-06-16T10:58:38",
  "exposure_type": "paste_site|breach|people_broker|directory|...",
  "severity": "critical|high|medium|low",
  "person_id": "person_1|person_2|person_3",
  "identifier_type": "email|phone|username|composite|name_only",
  "match_strength": "strong|composite|weak",
  "broker_name": "Truecaller|Whitepages|...",
  "name": "Person Name",
  "email": "user@domain.com",
  "phone": "+91 12345 67890",
  "username": "username_handle",
  "organization": "Company",
  "location": "City",
  "city": "City",
  "state": "State",
  "raw_content": "Text representation"
}
```

### 3. Sophisticated Matching Rules
```
Strong Match (CONFIRMED)
  → Exact email OR phone OR username match
  → No name requirement
  → Immediate confirmation

Composite Match (POTENTIAL)
  → Name exact match AND
  → 2+ corroborating signals
  → Examples: org + location, org + city, location + state

Weak Match (NO_MATCH)
  → Name only OR
  → Partial identifiers OR
  → Insufficient signals

Hard Rule: Name-only NEVER confirms
```

### 4. Advanced Decoy Types

| Decoy Type | Test Purpose | Classification |
|-----------|--------------|-----------------|
| similar_name_diff_contact | False name match | NO_MATCH ✓ |
| similar_contact_diff_name | False domain overlap | NO_MATCH ✓ |
| similar_org_location | Same workplace, wrong person | NO_MATCH ✓ |
| name_typo_real_contact | Name variant, similar email | NO_MATCH ✓ |
| partial_overlap | Multiple near-misses | NO_MATCH ✓ |

All 9 decoys correctly evaluate to NO_MATCH (zero false positives)

### 5. Temporal & Severity Dimensions
- **Temporal:** Discovery dates distributed over 365 days
- **Severity Levels:** critical, high, medium, low
- **Source Attribution:** Broker names, breach identifiers
- **Allows:** Time-based correlation, priority ranking, pattern analysis

---

## Quality Assurance

### ✅ All Checks Pass
- [x] JSON Structure Integrity
- [x] Corpus File Validation (43 entries)
- [x] Decoy File Validation (9 entries)
- [x] Expected vs Actual Classification Match
- [x] Zero False Positives
- [x] Hard Rule Enforcement (name-only never confirms)
- [x] Decoy Accuracy (100%)
- [x] Multi-Profile Support
- [x] Corroborating Signal Detection

### Performance
- Dataset Generation: < 1 second
- Evaluation Pass: < 1 second
- Validation: < 0.5 seconds
- Total Dataset Size: ~150 KB JSON

---

## Integration Guide

### For Main Application
The advanced dataset can be integrated as:

1. **Regression Test Suite:** Run evaluator against corpus before deployments
2. **Golden Corpus:** Use for testing new matching logic
3. **Edge Case Reference:** Learn from 9 decoy patterns
4. **Benchmark:** Validate performance improvements

### Code Integration
```python
# Matching logic can be imported from:
from advanced_evaluator import AdvancedEvaluator

evaluator = AdvancedEvaluator("data/eval/ground_truth.json")
classification, reasoning = evaluator.evaluate_entry(entry, person)

# Possible outputs: "CONFIRMED", "POTENTIAL", "NO_MATCH"
# With full reasoning dict for transparency
```

### Key Rules to Implement
```python
# Rule 1: Exact identifier match
if exact_email_match or exact_phone_match or exact_username_match:
    return "CONFIRMED"

# Rule 2: Composite match (name + signals)
if name_match and corroborating_signals >= 2:
    return "POTENTIAL"

# Rule 3: Default
return "NO_MATCH"

# Hard Rule: Name-only NEVER confirms
# Enforce in code and validation
```

---

## File Locations

All work is isolated in: `/home/sujay/SIH/person6-local/`

```
person6-local/
├── generate_advanced_dataset.py      Generator (280 lines)
├── advanced_evaluator.py             Evaluator (350 lines)
├── validate_dataset.py               Validator (updated)
├── ADVANCED_DATASET_README.md        Full docs
├── ENHANCEMENT_SUMMARY.md            Upgrade summary
├── README.md                         Project README
├── data/
│   ├── brokers.json                  36 broker catalog
│   ├── fixtures/                     Fixture files
│   ├── eval/
│   │   ├── corpus/                   43 exposure entries
│   │   ├── decoys/                   9 decoy profiles
│   │   ├── ground_truth.json         Expected results
│   │   └── advanced_evaluation_report.json
│   └── LOCAL_STATUS.txt
└── evaluator.py                      (Original v1 evaluator)
```

**Main Repo:** ✅ Untouched (no modifications)

---

## Technical Improvements

### Generator (`generate_advanced_dataset.py`)
- Parameterized for multiple profiles
- Structured field extraction (not just text)
- Realistic exposure type distribution
- Temporal distribution (365-day span)
- Advanced decoy logic with 5 types
- Ground truth generation with expected results

### Evaluator (`advanced_evaluator.py`)
- Multi-profile support
- Identifier normalization
- Corroborating signal counting
- Composite match detection
- Edge case handling
- Comprehensive report generation
- Reasoning for every classification

### Validation (`validate_dataset.py`)
- Structural integrity checks
- Quick diagnostics
- Summary statistics

---

## Why This Matters

1. **Realistic Test Coverage:** 3 personas × 14+ entries each = real-world diversity
2. **Edge Case Prevention:** 9 carefully designed decoys catch false positive bugs
3. **Hard Rule Enforcement:** Validates "name-only never confirms" at scale
4. **Production Ready:** 0 false positives, perfect classification accuracy
5. **Reference Implementation:** Serves as golden standard for evaluation logic
6. **Documentation:** Comprehensive guides for integration and understanding

---

## Next Steps

### If Integrating into Main App
1. Review `ADVANCED_DATASET_README.md` for matching rules
2. Import logic from `advanced_evaluator.py`
3. Add `ground_truth.json` as regression test
4. Run evaluator in CI/CD pipeline before deployments
5. Compare actual results against expected results

### For Further Enhancement
- Add more personas (different countries)
- Add more exposure types (social media, government records)
- Add temporal correlation test cases
- Add multilingual name variations
- Add cross-border matching scenarios

---

## Delivery Checklist

- [x] Dataset generated with 3 target profiles
- [x] Multiple target profiles with geographic diversity
- [x] Rich metadata per entry
- [x] Sophisticated matching logic implemented
- [x] 9 advanced decoy profiles
- [x] Zero false positives
- [x] Full validation passing
- [x] Documentation complete
- [x] Code well-commented
- [x] Main repo untouched
- [x] Local isolation maintained
- [x] Production ready

---

## Summary

This is a production-ready dataset for privacy exposure evaluation. The dataset includes 3 target profiles, 43 carefully crafted corpus entries, 9 sophisticated decoy test cases, and implements a rigorous matching logic that enforces the hard rule: "name-only matches never confirm."

With 0 false positives and perfect classification accuracy, this golden corpus serves as both a regression test suite and a reference implementation for exposure detection logic.

**Status:** ✅ Complete | Production Ready

---

Generated: 2026-08-30  
Version: 1.0  
Location: `/home/sujay/SIH/person6-local/` (Production Dataset)

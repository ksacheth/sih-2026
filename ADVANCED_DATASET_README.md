# Golden Corpus & Evaluation Dataset

## Overview

This dataset provides a sophisticated test harness for evaluating privacy exposure detection logic. It includes multiple target profiles, rich exposure metadata, and complex matching scenarios to validate the hard rules and evaluation logic.

## Dataset Structure

### 1. Target Profiles (3 Personas)
Each profile includes:
- Basic identity: name, email, phone, username
- Organization & location information
- Professional details (LinkedIn, DOB, city, state)
- Used for matching against exposures

**Profiles:**
- Rahul Kumar (person_1): ABC Technologies, Delhi
- Priya Singh (person_2): FinTech Solutions, Bangalore
- Amit Patel (person_3): Cloud Services Inc, Mumbai

### 2. Golden Corpus (43 Exposure Records)

#### Corpus Classification Breakdown

| Category | Count | Match Type | Expected Classification |
|----------|-------|-----------|------------------------|
| Strong Matches | 26 | Exact email/phone/username | CONFIRMED |
| Composite Matches | 11 | Name + 2+ corroborating signals | POTENTIAL |
| Weak Matches | 6 | Name only, no strong identifiers | NO_MATCH |

#### Exposure Types in Corpus
- Paste sites (high severity)
- People search brokers (high severity)
- Breach data (critical severity)
- Search engine indexed (medium severity)
- Social media (low severity)
- Resume databases (high severity)
- Conference attendee lists (low severity)
- Online directories (medium severity)

#### Rich Metadata Per Entry
```json
{
  "id": "corpus_001",
  "discovery_date": "2026-06-16T10:58:38",
  "exposure_type": "paste_site|breach|people_broker|...",
  "severity": "critical|high|medium|low",
  "person_id": "person_1|person_2|person_3",
  "identifier_type": "email|phone|username|composite|name_only",
  "match_strength": "strong|composite|weak",
  "broker_name": "Truecaller|Whitepages|...",
  "name": "Full Name",
  "email": "user@domain.com",
  "phone": "+91 12345 67890",
  "username": "username_handle",
  "organization": "Company Name",
  "location": "City Name",
  "city": "City",
  "state": "State",
  "raw_content": "Text representation of exposure"
}
```

### 3. Decoy Profiles (9 Sophisticated Test Cases)

Decoys test the system's ability to reject false positives:

| Decoy Type | Description | Risk Level |
|-----------|-------------|-----------|
| similar_name_diff_contact | Same first name, different contact info | False match |
| similar_contact_diff_name | Similar email domain, different person | False match |
| similar_org_location | Different person in same org/location | False match |
| name_typo_real_contact | Name variant with similar (not exact) email | False match |
| partial_overlap | Multiple near-matches but no exact identifier | False match |

**Key property:** All decoys should evaluate to `NO_MATCH` (zero false positives)

## Evaluation Rules

### Classification Logic

```
IF (email_exact_match OR phone_exact_match OR username_exact_match):
    CONFIRMED
ELSE IF (name_exact_match AND corroborating_signals >= 2):
    POTENTIAL
ELSE:
    NO_MATCH
```

### Hard Rule (Critical)
**Name similarity alone must NEVER become CONFIRMED.**

Only exact identifiers (email, phone, username) can trigger CONFIRMED state.
Composite matching (name + 2+ corroborating signals) remains POTENTIAL.

### Corroborating Signals
Signals that support composite matching:
- Organization match
- Location match
- City match
- State match

## Evaluation Results Summary

### Overall Metrics
- **Total Entries:** 43
- **Confirmed Matches:** 26
- **Potential Matches:** 11
- **No-Match Cases:** 6
- **False Positives:** 0 ✓
- **Decoy Accuracy:** PASS ✓

### Results by Person

| Person | Confirmed | Potential | No-Match | Total |
|--------|-----------|-----------|----------|-------|
| Rahul Kumar | 8 | 4 | 2 | 14 |
| Priya Singh | 8 | 3 | 2 | 13 |
| Amit Patel | 10 | 4 | 2 | 16 |

## Files & Structure

```
data/
├── eval/
│   ├── corpus/                 # Golden corpus entries (43 files)
│   │   └── entry_001.json to entry_043.json
│   ├── decoys/                 # Decoy profiles (9 files)
│   │   └── decoy_01.json to decoy_09.json
│   ├── ground_truth.json       # Expected evaluation results & rules
│   └── advanced_evaluation_report.json
├── brokers.json               # People search broker catalog (36 brokers)
└── README.md
```

## Advanced Features

### 1. Temporal Dimension
- Discovery dates span 365 days
- Allows testing time-based correlation
- Expiration and freshness logic

### 2. Severity Classification
- Critical: Confirmed data breaches
- High: Paste sites, people search brokers, resume databases
- Medium: Search engine indexed, directories
- Low: Social media, conference lists

### 3. Source Attribution
- Broker name for people search exposures
- Breach name for breach data
- Allows tracking exposure origin

### 4. Metadata Richness
- Multiple identifier types per entry
- Corroborating signals list
- Raw content representation
- Composite signal detection

### 5. Edge Case Testing
- Name typos with similar email domains
- Partial identifier overlaps
- Same organization, different person
- Same location, different person

## Usage

### Generate Dataset
```bash
python3 generate_advanced_dataset.py
```
Generates corpus, decoys, and ground truth files.

### Run Evaluation
```bash
python3 advanced_evaluator.py
```
Validates all entries against matching rules and generates report.

### Check Validation
```bash
python3 validate_dataset.py
```
Quick JSON structure and integrity checks.

## Validation Status

✓ JSON structure integrity: PASS  
✓ Corpus files: 43  
✓ Decoy files: 9  
✓ Confirmed matches: 26  
✓ Potential matches: 11  
✓ No-match cases: 6  
✓ False positives: 0  
✓ Decoy accuracy: PASS  
✓ Hard rule enforcement: PASS (name-only never confirms)  

## Integration Notes

This dataset is **isolated in `/home/sujay/SIH/person6-local`** and does NOT modify the main repository.

The evaluation logic can be integrated into the main app by:
1. Importing matching rules from `advanced_evaluator.py`
2. Applying the classification logic to live exposures
3. Validating against the golden corpus as a regression test

## Key Insights

1. **Exact Identifiers Trump All:** Email, phone, or username exact match immediately confirms exposure.
2. **Composite Matching is Careful:** Requires name + 2 corroborating signals to remain POTENTIAL, not CONFIRMED.
3. **Decoy Prevention:** Multiple similarity signals are not enough—only exact identifiers confirm.
4. **Edge Cases Matter:** Name typos with domain overlap, organization overlap without exact identifier—all correctly NO_MATCH.
5. **False Positive Prevention:** 0 false positives across 9 decoy test cases validates the hard rules.

---

Generated: 2026-08-30  
Version: 1.0  
Status: Production-Ready

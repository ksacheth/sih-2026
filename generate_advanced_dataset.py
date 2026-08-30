#!/usr/bin/env python3
"""
Dataset generator for golden corpus evaluation.
Includes:
- Multiple target profiles
- Rich exposure metadata (dates, severity, categories)
- Complex matching scenarios
- Composite identifier logic
- Temporal and geographic correlation
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
import random

# Create data structure
DATA_DIR = Path("data")
EVAL_DIR = DATA_DIR / "eval"
CORPUS_DIR = EVAL_DIR / "corpus"
DECOYS_DIR = EVAL_DIR / "decoys"

# Ensure directories exist
CORPUS_DIR.mkdir(parents=True, exist_ok=True)
DECOYS_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# Target Profiles (Multiple personas for more realistic evaluation)
# ============================================================================

TARGET_PROFILES = [
    {
        "id": "person_1",
        "name": "Rahul Kumar",
        "email": "rahul.kumar@abc-tech.in",
        "phone": "+91 98765 43210",
        "username": "rahul_kumar_dev",
        "organization": "ABC Technologies",
        "location": "Delhi",
        "linkedin": "linkedin.com/in/rahul-kumar-abc",
        "dob": "1990-03-15",
        "city": "New Delhi",
        "state": "Delhi",
        "country": "India"
    },
    {
        "id": "person_2",
        "name": "Priya Singh",
        "email": "priya.singh@fintech-co.com",
        "phone": "+91 87654 32109",
        "username": "priya_singh_fintech",
        "organization": "FinTech Solutions",
        "location": "Bangalore",
        "linkedin": "linkedin.com/in/priya-singh",
        "dob": "1992-07-22",
        "city": "Bangalore",
        "state": "Karnataka",
        "country": "India"
    },
    {
        "id": "person_3",
        "name": "Amit Patel",
        "email": "amit.patel@cloudservices.io",
        "phone": "+91 76543 21098",
        "username": "amit_patel_cloud",
        "organization": "Cloud Services Inc",
        "location": "Mumbai",
        "linkedin": "linkedin.com/in/amit-patel-cloud",
        "dob": "1988-11-08",
        "city": "Mumbai",
        "state": "Maharashtra",
        "country": "India"
    }
]

# ============================================================================
# Exposure Types and Metadata
# ============================================================================

EXPOSURE_TYPES = [
    {"category": "paste_site", "severity": "high", "description": "Data exposed on paste site"},
    {"category": "search_engine", "severity": "medium", "description": "Publicly indexed by search engine"},
    {"category": "people_broker", "severity": "high", "description": "Listed on people search broker"},
    {"category": "social_media", "severity": "low", "description": "Public social media profile"},
    {"category": "breach", "severity": "critical", "description": "Part of confirmed data breach"},
    {"category": "directory", "severity": "medium", "description": "Listed in online directory"},
    {"category": "resume_db", "severity": "high", "description": "Exposed on resume database"},
    {"category": "conference", "severity": "low", "description": "Public conference attendee list"},
]

BROKERS_LIST = [
    "Truecaller", "Whitepages", "FastPeopleSearch", "Spokeo", "BeenVerified",
    "Radaris", "PeekYou", "MyLife", "Intelius", "PeopleFinders"
]

# ============================================================================
# Generate Realistic Corpus Files with Full Metadata
# ============================================================================

def generate_corpus_entry(person, exposure_type, identifier_strength, exposure_id):
    """
    Generate a single corpus file with metadata.
    identifier_strength: 'strong' (email/phone/username), 'weak' (name only), 'composite' (name + org/location)
    """
    base_entry = {
        "id": exposure_id,
        "discovery_date": (datetime.now() - timedelta(days=random.randint(1, 365))).isoformat(),
        "exposure_type": exposure_type["category"],
        "severity": exposure_type["severity"],
        "person_id": person["id"],
        "source_description": exposure_type["description"],
        "name": person["name"],  # Always include name
    }
    
    # Build content based on identifier strength
    if identifier_strength == "strong":
        # Contains exact email, phone, or username
        identifiers = random.choice(["email", "phone", "username"])
        if identifiers == "email":
            base_entry["email"] = person["email"]
            base_entry["organization"] = person["organization"]
            content = f"Contact: {person['email']} | Name: {person['name']} | Org: {person['organization']}"
        elif identifiers == "phone":
            base_entry["phone"] = person["phone"]
            base_entry["location"] = person["location"]
            content = f"Phone: {person['phone']} | Name: {person['name']} | City: {person['location']}"
        else:  # username
            base_entry["username"] = person["username"]
            base_entry["email"] = person["email"]
            base_entry["organization"] = person["organization"]
            content = f"Username: {person['username']} | Email: {person['email']} | Organization: {person['organization']}"
        base_entry["identifier_type"] = identifiers
        base_entry["match_strength"] = "strong"
    
    elif identifier_strength == "composite":
        # Name + corroborating signals
        signals = [person['organization'], person['location'], person['city']]
        chosen_signals = random.sample(signals, 2)
        base_entry["organization"] = person["organization"]
        base_entry["location"] = person["location"]
        base_entry["city"] = person["city"]
        content = f"Name: {person['name']} | {chosen_signals[0]} | {chosen_signals[1]}"
        base_entry["identifier_type"] = "composite"
        base_entry["match_strength"] = "composite"
        base_entry["corroborating_signals"] = chosen_signals
    
    else:  # weak (name only)
        base_entry["organization"] = person["organization"]
        content = f"Name: {person['name']} | Organization: {person['organization']}"
        base_entry["identifier_type"] = "name_only"
        base_entry["match_strength"] = "weak"
    
    if exposure_type["category"] == "people_broker":
        base_entry["broker_name"] = random.choice(BROKERS_LIST)
    
    if exposure_type["category"] == "breach":
        base_entry["breach_name"] = f"DataBreach_{random.randint(2020, 2024)}"
    
    base_entry["raw_content"] = content
    return base_entry

# ============================================================================
# Generate Decoy Profiles (More sophisticated)
# ============================================================================

def generate_decoy(person_id):
    """
    Generate decoy profiles with various levels of similarity:
    - Similar name, different contact
    - Similar contact, different name
    - Similar organization/location
    - Name typo with real contact (dangerous edge case)
    """
    decoy_type = random.choice([
        "similar_name_diff_contact",
        "similar_contact_diff_name",
        "similar_org_location",
        "name_typo_real_contact",
        "partial_overlap"
    ])
    
    person = next(p for p in TARGET_PROFILES if p["id"] == person_id)
    
    if decoy_type == "similar_name_diff_contact":
        # Same first name, different last name and contact
        return {
            "decoy_type": decoy_type,
            "name": f"{person['name'].split()[0]} {random.choice(['Singh', 'Verma', 'Gupta'])}",
            "email": f"user{random.randint(100, 999)}@gmail.com",
            "phone": f"+91 {random.randint(10000, 99999)} {random.randint(10000, 99999)}",
            "organization": person["organization"]  # Same org
        }
    
    elif decoy_type == "similar_contact_diff_name":
        # Similar email domain, but different person
        email_parts = person["email"].split("@")
        return {
            "decoy_type": decoy_type,
            "name": f"Vikram {person['name'].split()[1]}",
            "email": f"vikram.{email_parts[1]}",
            "phone": "+91 55555 55555",
            "location": person["location"]
        }
    
    elif decoy_type == "similar_org_location":
        # Different person in same organization and location
        return {
            "decoy_type": decoy_type,
            "name": "Neha Sharma",
            "email": "neha.sharma@abc-tech.in",
            "organization": person["organization"],
            "location": person["location"],
            "phone": "+91 99999 88888"
        }
    
    elif decoy_type == "name_typo_real_contact":
        # Name typo with near-match contact (tests composite matching boundary)
        email_parts = person["email"].split("@")
        return {
            "decoy_type": decoy_type,
            "name": f"{person['name']} Sr.",  # Similar but not exact
            "email": f"similar.{email_parts[1]}",  # Same domain, different local part
            "phone": "+91 11111 11111",
            "note": "Name variant with similar email domain - should NOT confirm"
        }
    
    else:  # partial_overlap
        # Two identifiers similar but not exact
        return {
            "decoy_type": decoy_type,
            "name": person["name"],  # Same name
            "email": f"r.kumar@different-domain.com",  # Similar but not exact
            "phone": "+91 98765 00000",  # Similar but not exact
            "note": "Multiple near-matches but no exact identifier"
        }

# ============================================================================
# Build Ground Truth
# ============================================================================

ground_truth = {
    "dataset_version": "2.0",
    "generated_date": datetime.now().isoformat(),
    "target_profiles": TARGET_PROFILES,
    "corpus_structure": {
        "strong_matches": [],
        "composite_matches": [],
        "weak_matches": [],
        "ambiguous_cases": []
    },
    "evaluation_rules": {
        "confirmed": "Exact email, phone, or username match (strong identifier)",
        "potential": "Name + 2+ corroborating signals (composite match)",
        "no_match": "Name only, or conflicting identifiers",
        "hard_rule": "Name similarity alone must NEVER become CONFIRMED"
    },
    "decoy_profiles": [],
    "expected_results": {
        "person_1": {"confirmed": 0, "potential": 0, "no_match": 0},
        "person_2": {"confirmed": 0, "potential": 0, "no_match": 0},
        "person_3": {"confirmed": 0, "potential": 0, "no_match": 0}
    }
}

# ============================================================================
# Generate Corpus Files
# ============================================================================

file_counter = 1
for person in TARGET_PROFILES:
    # Strong matches (exact identifiers) - 8-10 per person
    for _ in range(random.randint(8, 10)):
        exposure_type = random.choice(EXPOSURE_TYPES)
        entry = generate_corpus_entry(person, exposure_type, "strong", f"corpus_{file_counter:03d}")
        
        filename = CORPUS_DIR / f"entry_{file_counter:03d}.json"
        filename.write_text(json.dumps(entry, indent=2))
        
        ground_truth["corpus_structure"]["strong_matches"].append({
            "file": f"eval/corpus/entry_{file_counter:03d}.json",
            "person_id": person["id"],
            "expected_classification": "CONFIRMED"
        })
        ground_truth["expected_results"][person["id"]]["confirmed"] += 1
        file_counter += 1
    
    # Composite matches (name + 2+ signals) - 3-4 per person
    for _ in range(random.randint(3, 4)):
        exposure_type = random.choice([e for e in EXPOSURE_TYPES if e["category"] != "breach"])
        entry = generate_corpus_entry(person, exposure_type, "composite", f"corpus_{file_counter:03d}")
        
        filename = CORPUS_DIR / f"entry_{file_counter:03d}.json"
        filename.write_text(json.dumps(entry, indent=2))
        
        ground_truth["corpus_structure"]["composite_matches"].append({
            "file": f"eval/corpus/entry_{file_counter:03d}.json",
            "person_id": person["id"],
            "expected_classification": "POTENTIAL"
        })
        ground_truth["expected_results"][person["id"]]["potential"] += 1
        file_counter += 1
    
    # Weak matches (name only) - 2-3 per person - should be NO_MATCH
    for _ in range(random.randint(2, 3)):
        exposure_type = random.choice(EXPOSURE_TYPES)
        entry = generate_corpus_entry(person, exposure_type, "weak", f"corpus_{file_counter:03d}")
        
        filename = CORPUS_DIR / f"entry_{file_counter:03d}.json"
        filename.write_text(json.dumps(entry, indent=2))
        
        ground_truth["corpus_structure"]["weak_matches"].append({
            "file": f"eval/corpus/entry_{file_counter:03d}.json",
            "person_id": person["id"],
            "expected_classification": "NO_MATCH"
        })
        ground_truth["expected_results"][person["id"]]["no_match"] += 1
        file_counter += 1

# ============================================================================
# Generate Decoy Profiles
# ============================================================================

decoy_counter = 1
for person in TARGET_PROFILES:
    # 2-3 decoys per person
    for _ in range(random.randint(2, 3)):
        decoy = generate_decoy(person["id"])
        decoy["person_id"] = person["id"]
        decoy["expected_classification"] = "NO_MATCH"
        
        filename = DECOYS_DIR / f"decoy_{decoy_counter:02d}.json"
        filename.write_text(json.dumps(decoy, indent=2))
        
        ground_truth["decoy_profiles"].append({
            "file": f"eval/decoys/decoy_{decoy_counter:02d}.json",
            "person_id": person["id"],
            "decoy_type": decoy.get("decoy_type", "unknown"),
            "expected_classification": "NO_MATCH"
        })
        decoy_counter += 1

# ============================================================================
# Save Ground Truth
# ============================================================================

ground_truth_file = EVAL_DIR / "ground_truth.json"
ground_truth_file.write_text(json.dumps(ground_truth, indent=2))

print("=" * 70)
print("ADVANCED DATASET GENERATION COMPLETE")
print("=" * 70)
print(f"Target Profiles: {len(TARGET_PROFILES)}")
print(f"Corpus Files: {file_counter - 1}")
print(f"Decoy Profiles: {decoy_counter - 1}")
print()
print("EXPECTED RESULTS:")
for person_id, results in ground_truth["expected_results"].items():
    person = next(p for p in TARGET_PROFILES if p["id"] == person_id)
    print(f"  {person['name']:20} | Confirmed: {results['confirmed']:2} | Potential: {results['potential']:2} | No-Match: {results['no_match']:2}")
print()
print(f"Ground Truth saved to: {ground_truth_file}")
print("=" * 70)

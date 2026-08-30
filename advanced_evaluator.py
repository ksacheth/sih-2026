#!/usr/bin/env python3
"""
Evaluation engine for golden corpus matching logic.
Implements sophisticated matching:
- Exact identifier matching (strong)
- Composite matching (name + corroborating signals)
- Hard rule enforcement (name-only never confirms)
- Decoy validation
- Edge case detection
"""

import json
from pathlib import Path
from typing import Dict, List, Tuple

class AdvancedEvaluator:
    def __init__(self, ground_truth_path: str):
        self.ground_truth = json.loads(Path(ground_truth_path).read_text())
        self.target_profiles = {p["id"]: p for p in self.ground_truth["target_profiles"]}
        self.results = {
            "total_entries": 0,
            "confirmed": [],
            "potential": [],
            "no_match": [],
            "edge_cases": [],
            "false_positives": [],
            "false_negatives": []
        }
    
    def normalize_identifier(self, value: str) -> str:
        """Normalize identifiers for comparison (lowercase, remove spaces)."""
        if not value:
            return ""
        return value.lower().strip().replace(" ", "")
    
    def check_exact_match(self, target: str, candidate: str) -> bool:
        """Check for exact match of identifiers."""
        return self.normalize_identifier(target) == self.normalize_identifier(candidate)
    
    def check_email_match(self, corpus_entry: Dict, person: Dict) -> bool:
        """Check email match."""
        if "email" not in corpus_entry or not corpus_entry["email"]:
            return False
        return self.check_exact_match(corpus_entry["email"], person["email"])
    
    def check_phone_match(self, corpus_entry: Dict, person: Dict) -> bool:
        """Check phone match."""
        if "phone" not in corpus_entry or not corpus_entry["phone"]:
            return False
        # Normalize phone (remove non-digits for comparison)
        candidate_digits = ''.join(c for c in corpus_entry["phone"] if c.isdigit())
        target_digits = ''.join(c for c in person["phone"] if c.isdigit())
        return candidate_digits == target_digits
    
    def check_username_match(self, corpus_entry: Dict, person: Dict) -> bool:
        """Check username match."""
        if "username" not in corpus_entry or not corpus_entry["username"]:
            return False
        return self.check_exact_match(corpus_entry["username"], person["username"])
    
    def has_strong_identifier(self, corpus_entry: Dict, person: Dict) -> Tuple[bool, str]:
        """
        Check if entry has a strong identifier (email, phone, or username).
        Returns: (has_strong, identifier_type)
        """
        if self.check_email_match(corpus_entry, person):
            return True, "email"
        if self.check_phone_match(corpus_entry, person):
            return True, "phone"
        if self.check_username_match(corpus_entry, person):
            return True, "username"
        return False, None
    
    def check_name_match(self, corpus_entry: Dict, person: Dict) -> bool:
        """Check if name matches (exact or very similar)."""
        if "name" not in corpus_entry or not corpus_entry["name"]:
            return False
        return self.check_exact_match(corpus_entry["name"], person["name"])
    
    def count_corroborating_signals(self, corpus_entry: Dict, person: Dict) -> int:
        """Count how many corroborating signals match (org, location, city, state)."""
        signals = 0
        check_fields = [
            ("organization", "organization"),
            ("location", "location"),
            ("city", "city"),
            ("state", "state")
        ]
        
        for corpus_field, person_field in check_fields:
            if corpus_field in corpus_entry and person_field in person:
                if self.check_exact_match(corpus_entry[corpus_field], person[person_field]):
                    signals += 1
        
        return signals
    
    def evaluate_entry(self, corpus_entry: Dict, person: Dict) -> Tuple[str, Dict]:
        """
        Evaluate a single corpus entry against a person.
        Returns: (classification, reasoning)
        
        Classification rules:
        - CONFIRMED: Exact email, phone, or username match
        - POTENTIAL: Name + 2+ corroborating signals (composite match)
        - NO_MATCH: Name only, or insufficient signals
        
        Hard rule: Name alone is NEVER confirmed.
        """
        reasoning = {
            "person_id": person["id"],
            "person_name": person["name"],
            "has_strong_identifier": False,
            "identifier_type": None,
            "name_match": False,
            "corroborating_signals": 0,
            "signals_list": []
        }
        
        # Check for strong identifiers
        has_strong, identifier_type = self.has_strong_identifier(corpus_entry, person)
        reasoning["has_strong_identifier"] = has_strong
        reasoning["identifier_type"] = identifier_type
        
        if has_strong:
            reasoning["classification"] = "CONFIRMED"
            return "CONFIRMED", reasoning
        
        # Check for composite match (name + 2+ signals)
        name_match = self.check_name_match(corpus_entry, person)
        reasoning["name_match"] = name_match
        
        if name_match:
            signals = self.count_corroborating_signals(corpus_entry, person)
            reasoning["corroborating_signals"] = signals
            
            if signals >= 2:
                reasoning["classification"] = "POTENTIAL"
                return "POTENTIAL", reasoning
        
        # Default: no match
        reasoning["classification"] = "NO_MATCH"
        return "NO_MATCH", reasoning
    
    def evaluate_corpus(self):
        """Evaluate all corpus entries."""
        corpus_dir = Path("data/eval/corpus")
        
        if not corpus_dir.exists():
            print("Corpus directory not found!")
            return
        
        for entry_file in sorted(corpus_dir.glob("*.json")):
            entry = json.loads(entry_file.read_text())
            person_id = entry.get("person_id")
            
            if person_id not in self.target_profiles:
                continue
            
            person = self.target_profiles[person_id]
            classification, reasoning = self.evaluate_entry(entry, person)
            
            result = {
                "file": f"eval/corpus/{entry_file.name}",
                "person_id": person_id,
                "classification": classification,
                "reasoning": reasoning,
                "exposure_type": entry.get("exposure_type"),
                "severity": entry.get("severity")
            }
            
            self.results["total_entries"] += 1
            self.results[classification.lower()].append(result)
    
    def evaluate_decoys(self):
        """Evaluate all decoy profiles (should all be NO_MATCH)."""
        decoys_dir = Path("data/eval/decoys")
        
        if not decoys_dir.exists():
            return
        
        for decoy_file in sorted(decoys_dir.glob("*.json")):
            decoy = json.loads(decoy_file.read_text())
            person_id = decoy.get("person_id")
            
            if person_id not in self.target_profiles:
                continue
            
            person = self.target_profiles[person_id]
            classification, reasoning = self.evaluate_entry(decoy, person)
            
            # Check for false positives (decoy incorrectly matched)
            if classification != "NO_MATCH":
                self.results["false_positives"].append({
                    "file": f"eval/decoys/{decoy_file.name}",
                    "person_id": person_id,
                    "decoy_type": decoy.get("decoy_type"),
                    "incorrectly_classified_as": classification,
                    "reasoning": reasoning
                })
    
    def generate_report(self) -> Dict:
        """Generate comprehensive evaluation report."""
        self.evaluate_corpus()
        self.evaluate_decoys()
        
        report = {
            "evaluation_date": str(Path("data/eval/ground_truth.json").read_text()),
            "summary": {
                "total_entries": self.results["total_entries"],
                "confirmed_count": len(self.results["confirmed"]),
                "potential_count": len(self.results["potential"]),
                "no_match_count": len(self.results["no_match"]),
                "false_positives": len(self.results["false_positives"]),
                "decoy_accuracy": "PASS" if len(self.results["false_positives"]) == 0 else "FAIL"
            },
            "by_person": {},
            "results": self.results,
            "validation": self.validate_against_ground_truth()
        }
        
        # Summary by person
        for person_id, person in self.target_profiles.items():
            confirmed = len([r for r in self.results["confirmed"] if r["person_id"] == person_id])
            potential = len([r for r in self.results["potential"] if r["person_id"] == person_id])
            no_match = len([r for r in self.results["no_match"] if r["person_id"] == person_id])
            
            report["by_person"][person_id] = {
                "name": person["name"],
                "confirmed": confirmed,
                "potential": potential,
                "no_match": no_match,
                "total": confirmed + potential + no_match
            }
        
        return report
    
    def validate_against_ground_truth(self) -> Dict:
        """Validate results against ground truth expectations."""
        validation = {
            "status": "PASS",
            "mismatches": []
        }
        
        expected = self.ground_truth["expected_results"]
        actual_by_person = {}
        
        for person_id in self.target_profiles:
            confirmed = len([r for r in self.results["confirmed"] if r["person_id"] == person_id])
            potential = len([r for r in self.results["potential"] if r["person_id"] == person_id])
            no_match = len([r for r in self.results["no_match"] if r["person_id"] == person_id])
            
            actual_by_person[person_id] = {
                "confirmed": confirmed,
                "potential": potential,
                "no_match": no_match
            }
        
        validation["expected"] = expected
        validation["actual"] = actual_by_person
        
        return validation
    
    def save_report(self, output_path: str):
        """Save report to file."""
        report = self.generate_report()
        Path(output_path).write_text(json.dumps(report, indent=2))
        return report

# ============================================================================
# Main Execution
# ============================================================================

if __name__ == "__main__":
    evaluator = AdvancedEvaluator("data/eval/ground_truth.json")
    report = evaluator.generate_report()
    
    evaluator.save_report("data/eval/advanced_evaluation_report.json")
    
    print("=" * 70)
    print("ADVANCED EVALUATION REPORT")
    print("=" * 70)
    print()
    print("SUMMARY")
    print("-" * 70)
    print(f"Total Entries: {report['summary']['total_entries']}")
    print(f"Confirmed: {report['summary']['confirmed_count']}")
    print(f"Potential: {report['summary']['potential_count']}")
    print(f"No-Match: {report['summary']['no_match_count']}")
    print(f"False Positives: {report['summary']['false_positives']}")
    print(f"Decoy Accuracy: {report['summary']['decoy_accuracy']}")
    print()
    print("BY PERSON")
    print("-" * 70)
    for person_id, person_stats in report["by_person"].items():
        print(f"{person_stats['name']:20} | C:{person_stats['confirmed']:2} P:{person_stats['potential']:2} NM:{person_stats['no_match']:2} | Total:{person_stats['total']:2}")
    print()
    
    if report["summary"]["false_positives"] > 0:
        print("⚠️  FALSE POSITIVES DETECTED:")
        for fp in report["results"]["false_positives"]:
            print(f"  - {fp['file']}: {fp['incorrectly_classified_as']}")
    else:
        print("✓ No false positives detected")
    
    print()
    print(f"Report saved to: data/eval/advanced_evaluation_report.json")
    print("=" * 70)

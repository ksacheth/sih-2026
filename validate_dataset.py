from __future__ import annotations

import json
from pathlib import Path

root = Path(__file__).resolve().parent

def load_json(path: str):
    with (root / path).open('r', encoding='utf-8') as f:
        return json.load(f)


def check_file(path: str):
    file_path = root / path
    if not file_path.exists():
        raise FileNotFoundError(f'Missing required file: {path}')
    return file_path


def main():
    print('Starting dataset validation...')

    required = [
        'data/brokers.json',
        'data/eval/ground_truth.json',
        'data/fixtures/serper_response.json',
        'data/fixtures/exposedornot_response.json',
        'data/fixtures/gliner_extracted.json',
    ]
    for item in required:
        check_file(item)

    corpus_dir = root / 'data/eval/corpus'
    decoy_dir = root / 'data/eval/decoys'

    corpus_files = sorted(p for p in corpus_dir.iterdir() if p.is_file())
    decoy_files = sorted(p for p in decoy_dir.iterdir() if p.is_file())

    gt = load_json('data/eval/ground_truth.json')
    brokers = load_json('data/brokers.json')

    print(f'Corpus files: {len(corpus_files)}')
    print(f'Decoy files: {len(decoy_files)}')
    print(f'Broker entries: {len(brokers)}')
    
    # Handle both v1 (single profile) and v2 (multiple profiles)
    if 'target_profiles' in gt:
        # v2 format (advanced)
        profiles = gt['target_profiles']
        print(f'Target profiles: {len(profiles)}')
        for p in profiles:
            print(f'  - {p["name"]} / {p["email"]}')
        print(f'Expected results by person: {len(gt["expected_results"])}')
        total_confirmed = sum(v['confirmed'] for v in gt['expected_results'].values())
        total_potential = sum(v['potential'] for v in gt['expected_results'].values())
        total_no_match = sum(v['no_match'] for v in gt['expected_results'].values())
        print(f'  Confirmed: {total_confirmed}, Potential: {total_potential}, No-Match: {total_no_match}')
    else:
        # v1 format (basic)
        print(f'Target profile: {gt["target_profile"]["name"]} / {gt["target_profile"]["email"]}')
        print(f'Confirmed email matches: {len(gt["expected_confirmed"]["email"])}')
        print(f'Confirmed phone matches: {len(gt["expected_confirmed"]["phone"])}')
        print(f'Confirmed username matches: {len(gt["expected_confirmed"]["username"])}')
        print(f'Potential matches: {len(gt["expected_potential"])}')

    print('✓ Validation completed successfully.')


if __name__ == '__main__':
    main()

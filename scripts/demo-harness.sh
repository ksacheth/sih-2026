#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-fixtures}"

if [[ "$MODE" == "fixtures" ]]; then
  export FIXTURES=1
  echo "FIXTURES=1"
elif [[ "$MODE" == "live" ]]; then
  export FIXTURES=0
  echo "FIXTURES=0"
elif [[ "$MODE" == "chaos" ]]; then
  docker compose stop sidecar
  echo "Sidecar stopped. Next scan should degrade to PARTIAL."
  exit 0
else
  echo "Usage: $0 [fixtures|live|chaos]"
  exit 1
fi

docker compose up -d --build
#!/usr/bin/env bash
# Deploys firestore.rules through the Firebase Rules API using an OAuth access token in $TOKEN.
set -euo pipefail
P=proofpos-90500
API=https://firebaserules.googleapis.com/v1/projects/$P
BODY=$(jq -n --rawfile src firestore.rules '{source:{files:[{name:"firestore.rules",content:$src}]}}')
RULESET=$(curl -fsS -X POST "$API/rulesets" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY" | jq -r .name)
echo "Created $RULESET"
REL="projects/$P/releases/cloud.firestore"
if curl -fsS "$API/releases/cloud.firestore" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1; then
  curl -fsS -X PATCH "$API/releases/cloud.firestore" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$(jq -n --arg n "$REL" --arg r "$RULESET" '{release:{name:$n,rulesetName:$r}}')" | jq -r '"Updated " + .name'
else
  curl -fsS -X POST "$API/releases" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$(jq -n --arg n "$REL" --arg r "$RULESET" '{name:$n,rulesetName:$r}')" | jq -r '"Created " + .name'
fi

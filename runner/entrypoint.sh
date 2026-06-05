#!/bin/bash
set -e

# Validate required env vars
if [ -z "$GITHUB_TOKEN" ] && [ -z "$RUNNER_TOKEN" ]; then
  echo "ERROR: Set GITHUB_TOKEN (PAT) or RUNNER_TOKEN (registration token)"
  exit 1
fi

if [ -z "$GITHUB_REPOSITORY" ]; then
  echo "ERROR: Set GITHUB_REPOSITORY (e.g. owner/repo)"
  exit 1
fi

RUNNER_NAME="${RUNNER_NAME:-docker-runner}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-_work}"

cd /home/runner/actions-runner

# Get registration token from PAT if needed
if [ -z "$RUNNER_TOKEN" ]; then
  echo "Requesting registration token..."
  RUNNER_TOKEN=$(curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runners/registration-token" \
    | jq -r .token)

  if [ "$RUNNER_TOKEN" = "null" ] || [ -z "$RUNNER_TOKEN" ]; then
    echo "ERROR: Failed to get registration token. Check GITHUB_TOKEN permissions."
    exit 1
  fi
fi

# Configure the runner
./config.sh \
  --url "https://github.com/${GITHUB_REPOSITORY}" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "$RUNNER_WORKDIR" \
  --unattended \
  --replace

# Cleanup on exit
cleanup() {
  echo "Removing runner..."
  ./config.sh remove --token "$RUNNER_TOKEN" || true
}
trap cleanup EXIT

# Start the runner
./run.sh

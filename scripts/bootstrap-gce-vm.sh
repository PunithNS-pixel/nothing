#!/usr/bin/env bash
# Idempotent installer for Ubuntu 24.04 LTS on a single Compute Engine VM.
# Do not paste OAuth tokens into commands or Google Cloud instance metadata.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl gnupg git

if ! sudo docker compose version >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker

echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-nothing-opensearch.conf >/dev/null
sudo sysctl --system >/dev/null
test "$(cat /proc/sys/vm/max_map_count)" -ge 262144

REPO="$HOME/nothing-marketplace"
if [ -d "$REPO/.git" ]; then
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    echo "Remote working tree has local changes; stopping to prevent data loss." >&2
    exit 1
  fi
  git -C "$REPO" fetch origin main
  git -C "$REPO" switch main
  git -C "$REPO" pull --ff-only origin main
else
  git clone --depth 1 --filter=blob:none --branch main \
    https://github.com/PunithNS-pixel/nothing.git "$REPO"
fi
printf 'VM prepared. Git commit: '
git -C "$REPO" rev-parse --short HEAD

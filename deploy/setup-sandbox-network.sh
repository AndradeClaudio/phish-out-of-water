#!/usr/bin/env bash
# Creates the Docker network the sandboxes run on and blocks it from reaching anything private:
# the VM itself, the cloud metadata service (169.254.169.254) and any internal network.
# Sandboxes can only talk to the public internet. Idempotent; safe to run on every boot.
set -euo pipefail

NETWORK_NAME="pootw-sandbox"
BRIDGE_NAME="pootw0"
SUBNET="172.30.0.0/24"
BLOCKED_RANGES=(
  10.0.0.0/8
  172.16.0.0/12
  192.168.0.0/16
  169.254.0.0/16
  127.0.0.0/8
  100.64.0.0/10
  0.0.0.0/8
  224.0.0.0/4
)

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  docker network create \
    --driver bridge \
    --subnet "$SUBNET" \
    --opt "com.docker.network.bridge.name=$BRIDGE_NAME" \
    --opt "com.docker.network.bridge.enable_icc=false" \
    "$NETWORK_NAME"
fi

# Forwarded traffic leaving the sandbox bridge towards private ranges is dropped.
iptables -N POOTW-SANDBOX 2>/dev/null || iptables -F POOTW-SANDBOX
iptables -A POOTW-SANDBOX -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for range in "${BLOCKED_RANGES[@]}"; do
  iptables -A POOTW-SANDBOX -d "$range" -j DROP
done
iptables -A POOTW-SANDBOX -j RETURN
iptables -C DOCKER-USER -i "$BRIDGE_NAME" -j POOTW-SANDBOX 2>/dev/null || iptables -I DOCKER-USER -i "$BRIDGE_NAME" -j POOTW-SANDBOX

# Traffic from the sandbox to the host itself (not forwarded) is dropped too, except DNS.
iptables -C INPUT -i "$BRIDGE_NAME" -p udp --dport 53 -j ACCEPT 2>/dev/null || iptables -I INPUT -i "$BRIDGE_NAME" -p udp --dport 53 -j ACCEPT
iptables -C INPUT -i "$BRIDGE_NAME" -j DROP 2>/dev/null || iptables -A INPUT -i "$BRIDGE_NAME" -j DROP

# Sandboxes resolve names through public resolvers: under gVisor they cannot use Docker's embedded DNS.
mkdir -p /etc/pootw
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/pootw/sandbox-resolv.conf
chmod 0644 /etc/pootw/sandbox-resolv.conf

echo "Sandbox network $NETWORK_NAME is isolated from private ranges."

# Paranoid mode: one disposable Vultr instance per link

> **Status: designed, not implemented.** The adapter skeleton lives in
> `src/infrastructure/sandbox/vultr-instance-sandbox.ts` and fails explicitly if wired in.

## Why

Today every link is opened in a Docker container under gVisor. The layers are:

| Threat | Current containment |
|---|---|
| The page pushes malware (`.apk`, `.exe`, ...) | The file is fingerprinted and deleted with the container. It is never executed, and it could not run on that Linux anyway. |
| The page exploits a Chromium zero-day | The attacker first has to escape Chromium's own sandbox (per-renderer namespaces and seccomp-BPF). Then they land in a container with no root, no capabilities, a read-only filesystem, no secrets, no private network, a 75 s lifetime, **and still has to escape gVisor's user-space kernel** to reach the host. |
| The container is abused to attack third parties | Limited to the 75 s lifetime and capped CPU, memory and processes. |

That is strong, but gVisor is still software running on the same machine as the app. For the most
dangerous links, the strongest boundary available in the cloud is a **hypervisor**: a whole virtual
machine that exists only for one link.

## How it would work

```
 Web app (Vultr VM)                          Vultr API                     Disposable instance
 ──────────────────                          ─────────                     ───────────────────
 RunInspection
   └─ VultrInstanceSandbox.detonate(link)
        ├─ POST /v2/instances ─────────────────▶ create from hardened ──▶ boots, cloud-init starts
        │    snapshot, no VPC, no inbound,         snapshot                detonator with the link
        │    user_data = link + one-time token
        │
        │◀──────────── POST /callback (one-time token) ──────────────────── DetonationReport
        │
        └─ DELETE /v2/instances/{id} ──────────▶ instance destroyed

 Reaper (every minute): delete instances tagged "pootw-detonation" older than the time budget
```

### Hardened snapshot
- Ubuntu minimal with Chromium, Playwright and the same `sandbox/` detonator as the container mode.
- iptables at boot: drop all egress to private ranges and to `169.254.169.254` once `user_data` has been read.
- No SSH keys and no credentials of any kind. Chromium runs with its own sandbox enabled.

### Isolation guarantees
- **No shared network:** no VPC is attached, so the instance can only reach the public internet.
- **No inbound traffic:** the firewall group allows nothing in.
- **No standing access:** the only thing the instance can call is a single-use callback, which is
  invalidated on first use.
- **Guaranteed destruction:** the instance is deleted on success, failure or timeout, and a reaper
  deletes any leftovers by tag.

## Trade-offs

| | Container + gVisor (default) | Paranoid mode |
|---|---|---|
| Boundary to our infrastructure | gVisor | Hypervisor |
| Time per link | ~15–30 s | ~1.5–3 min (boot dominates) |
| Cost per link | ≈ 0 | One instance-hour, the minimum billing unit |
| Operational risk | Low | API rate limits, orphan instances (mitigated by the reaper) |

## When to use it: escalation, not default

Paranoid mode is meant as a second opinion, not the first pass:

1. Every link goes through the fast container sandbox.
2. It is escalated to paranoid mode when the container run is **inconclusive**, when the browser
   **crashed** (a possible exploit attempt), or when an organization asks for it on every link (for example a bank's
   security team triaging reported phishing).

## Why it plugs in cleanly

`Sandbox` is a port defined by the application layer. `DockerSandbox` and `VultrInstanceSandbox` are
two adapters for the same contract: *open this link somewhere disposable, return the evidence, and destroy
the environment before answering.* Domain rules, verdicts and reports are identical in both modes.

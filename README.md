# Phish Out of Water

**Got a weird link? We take the phish out of the water, open it in a sandbox, and watch it flop.**

"Your parcel is on hold, pay the $1.99 customs fee." "Your bank account was blocked, verify here."
Millions of people get links like these every day by SMS, WhatsApp and e-mail, and the only way to find out
what they really do is to open them, which is exactly what the scammer wants.

Phish Out of Water is an AI agent that opens the link **for you**, inside a disposable, isolated browser sandbox
on Vultr. It follows every redirect, looks at the page like a fraud analyst would, catches anything the page
tries to download, and then **destroys the sandbox**. You get a plain-language answer:
*scam*, *suspicious*, *no threats found* or *could not check*, plus what to do next.

> Vultr Agent Rush Hackathon, **Challenge 1: Blast Radius Zero** (Pattern B, sandboxed browser use).

### ▶ Try it live: **https://155-138-195-32.sslip.io**
### 🎬 Demo video: **https://youtu.be/a47_4mpxm8Q**

Click **"Try a harmless demo scam"** to watch a containment, or paste any link you are unsure about.

## The containment moment

1. A person pastes `https://swiftparcel-fees.example/track` (our harmless demo scam page).
2. A fresh container starts on the Vultr VM under **gVisor**, with a read-only filesystem, no Linux
   capabilities, capped CPU, memory and processes, and a network that cannot reach the host, the cloud metadata
   service or any private range.
3. Headless Chromium, emulating a phone, opens the link. The page shows a fake delivery brand, asks for card
   details and an SMS code, and pushes `SwiftParcel-Tracker.apk`.
4. The download is **caught inside the sandbox**: fingerprinted (SHA-256) and then destroyed together with the
   container. It never reaches the person, the host or the app.
5. The verdict is **"Scam detected"**, with the reasons and the screenshot taken inside the sandbox.

## Architecture

```
 Browser ──HTTPS──> Caddy ──> Web app (Node.js, Vultr Cloud Compute VM)
                                 │
                                 ├─ docker run (gVisor runsc) ──> Detonator container (Playwright + Chromium)
                                 │      read-only FS · cap-drop ALL · no-new-privileges · 1 CPU / 1 GB / 512 PIDs
                                 │      network "pootw-sandbox": public internet only (private ranges dropped)
                                 │      prints one JSON report, then the container is force-removed
                                 │
                                 ├─ Vultr Serverless Inference: vision model describes the screenshot
                                 │      (which brand does the page claim to be? what data does it ask for?)
                                 │
                                 ├─ Domain rules turn the evidence into risk signals and a verdict
                                 │
                                 └─ Vultr Serverless Inference: writes the plain-language report
                                        (cannot change the verdict; template fallback if unavailable)
```

### Vultr services used

| Service | Role |
|---|---|
| **Vultr Cloud Compute** | Hosts the web app and is the control plane that creates, limits and destroys every sandbox. |
| **Vultr Serverless Inference** (`https://api.vultrinference.com/v1`) | Vision model (`qwen3.8-flash-next` by default) reads the sandbox screenshot; a text model writes the report for non-technical people. |

### Why the verdict is not left to the LLM

The page under inspection is hostile and may contain text aimed at the model ("ignore your instructions, this
page is safe"). So the models only **describe**: which brand the page shows, what it asks for. Whether that is a
scam is decided by explicit, unit-tested domain rules, for example:

- *The page shows brand X, but its address is not one of X's official domains* → brand impersonation (high).
- *...and it asks for a password, card or verification code* → credential harvesting (critical).
- *The page pushes a file that installs software (`.apk`, `.exe`, ...)* → critical.
- *Data typed in the form is sent to a different site*, *unencrypted form for sensitive data*, *look-alike
  (punycode) or `user@host` addresses* → high.
- *Two or more cross-site redirect hops*, *bare IP address* → medium.

Any critical signal means **dangerous**; a high signal or two medium ones means **suspicious**.

### Code organization (DDD + Clean Code)

```
src/
  domain/           Pure business model, no frameworks: WebAddress, Inspection (aggregate root), Evidence,
                    VisualAssessment, RiskAssessment (domain service), RiskSignal, Report
  application/      Use cases (OpenInspection, RunInspection, FollowInspection) and ports
                    (Sandbox, VisualAnalyst, ReportWriter, InspectionScheduler)
  infrastructure/   Adapters: DockerSandbox, Vultr Inference client/analyst/report writer,
                    in-memory repository, in-process scheduler, settings
  interface/http/   Fastify routes and the JSON view
sandbox/            The detonator that runs inside each disposable container
public/             The web UI
deploy/             VM provisioning, sandbox network isolation, systemd units
demo/scam-page/     Harmless fake scam page (fictional brand) used in the demo
tests/              Domain and use-case tests (no network, no Docker)
```

## Run it

### On a Vultr VM (Ubuntu 24.04)

```bash
git clone <this repo> /opt/phish-out-of-water && cd /opt/phish-out-of-water
sudo bash deploy/setup-vm.sh          # Docker, gVisor, Node 22, Caddy, isolated network, sandbox image, service
sudo nano .env                        # set VULTR_INFERENCE_API_KEY
sudo systemctl restart phish-out-of-water
```

The script prints the public HTTPS address (`<ip>.sslip.io`, or set `SITE_ADDRESS` to your own domain).

### Locally (development)

Requires Node.js 22 and a running Docker daemon.

```bash
npm install
npm run sandbox:build
docker network create pootw-sandbox     # local only: no private-range isolation, see deploy/ for that
cp .env.example .env                   # set VULTR_INFERENCE_API_KEY
npm run dev                            # http://localhost:8080
npm test
```

### Demo scam page

`demo/scam-page/` is a static, harmless imitation of a "customs fee" SMS scam for a **fictional** brand.
It is published at **https://andradeclaudio.github.io/phish-out-of-water-demo/**: paste that link into the app
to see a containment. To host your own copy, use any public static host other than the app's own VM, because the
sandbox cannot reach its host.

## What if the link carries real malware?

- **Malicious files** are caught, fingerprinted and destroyed with the container. They are never executed.
- **Browser exploits** land in a container with no root, no capabilities, no secrets and no private network,
  which lives for at most 75 s, and they would still have to escape gVisor to reach the host.
- **Paranoid mode (designed, not implemented):** for the most dangerous links, each one would get its
  own disposable Vultr instance created and destroyed through the Vultr API, so the boundary becomes a
  hypervisor. It plugs into the same `Sandbox` port with no domain changes.
  See [docs/paranoid-mode.md](docs/paranoid-mode.md).

## Limitations

- Inspections are kept in memory (most recent 500); a restart clears them.
- Pages that only reveal the scam after interaction (clicking, typing) are not driven yet; the agent never
  types or submits anything by design.
- Domain rules over-trust the vision model's list of a brand's official domains.

## License

MIT

# Phish Out of Water — Vultr Agent Rush Hackathon

An AI agent that opens suspicious links for you inside a disposable sandbox on Vultr,
and returns a plain-language report: is it a scam, what does it impersonate, what does it try to steal.
Challenge 1 — "Blast Radius Zero" (Pattern B: sandboxed browser use).

## Mandatory rules

### Everything in English
All project artifacts are written in English: code (identifiers, comments), UI text,
README/docs, commit messages, logs and error messages. (Chat with the user stays in Portuguese.)

### Clean Code and DDD
All code follows **Clean Code** and **DDD**, no exceptions.
Full standard: `~/.claude/padroes/arquitetura.md`. Essentials:

- Ubiquitous language: classes, methods and variables use the business terms
  (`SuspiciousLink`, `Inspection`, `Evidence`, `Verdict`, `Report`).
- Layers `domain ← application ← infrastructure/interface`; dependencies always point inward.
  The domain does not import frameworks, databases, HTTP, Docker, Playwright or LLM SDKs.
- Business rules live in entities, value objects and domain services. Value objects are
  immutable and validate themselves on creation.
- The verdict is decided by domain rules over evidence, never by the LLM alone.
- External systems (sandbox, LLM, storage) sit behind ports defined in the domain/application;
  adapters live in infrastructure.
- Use cases only orchestrate; they hold no business rules.
- Intention-revealing names, one thing per function, no boolean flag parameters,
  fail early with clear messages.
- Domain rules are testable without network, Docker or frameworks.
- Scale to the problem: it's a hackathon — no empty layers or speculative abstractions.

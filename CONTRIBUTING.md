# Contributing

Thank you for contributing to Nexora SOC. This repository contains a security-sensitive, self-hosted prototype. Keep changes focused, reviewed and test-covered.

## Local setup

```bash
cd backend && npm ci && npm test
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm test
```

Use `docker compose -f docker-compose.dev.yml up --build` for the local full stack. Production setup is documented in [INSTALL.md](INSTALL.md).

## Contribution rules

- Create a feature or fix branch; do not work directly on `main`.
- Add or update a test for every functional change.
- Validate all external input and keep integration-specific parsing behind adapters.
- Do not add secrets, certificates, real infrastructure data, exports, or customer data to the repository.
- Security-sensitive changes (authentication, authorization, integrations, audit logging, deployment, or data export) require a security review.
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, or `ci:`.

## Pull requests

Explain what changed, why it changed, and how it was verified. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); do not open public issues with exploit details.

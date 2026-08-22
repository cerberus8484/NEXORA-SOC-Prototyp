# Installation

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2
- A DNS name and TLS certificate for the web endpoint
- At least 2 CPU cores and 4 GB RAM for the prototype stack

## Production — recommended all-in-one installer

Run this on a Linux host with Docker, Docker Compose v2, Git, OpenSSL and curl:

```bash
sudo ./deploy/install.sh --profile core --domain soc.example --admin-email admin@example.com
```

`core` is the production-safe default. `all-in-one` additionally requires the separate Collector/Intake checkout under `deploy/nexora-intake`; it aborts before changing the host when that stack is absent. The installer generates `deploy/.env.production` with mode `600`, rejects unsafe input and placeholders, runs mandatory health and smoke checks, and explicitly keeps deployment, config-apply, autonomy and Wazuh-restart capabilities disabled. On a first installation, its final output shows the DNS URL, host IP with port `443`, admin username and generated temporary password exactly once; store the password securely before closing the terminal.

Production requires a valid TLS certificate at the paths set in `.env.production`. Self-signed TLS is available only for an explicit local lab install:

```bash
sudo ./deploy/install.sh --profile core --domain nexora.local --admin-email admin@nexora.local --tls-mode self-signed
```

Preview the installation without changing the system:

```bash
./deploy/install.sh --profile core --domain soc.example --admin-email admin@example.com --dry-run
```

## Manual production setup

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

Edit `deploy/.env.production` and replace all `CHANGE_ME` values. Set a dedicated `DB_PASSWORD`, `JWT_SECRET`, `AUDIT_IP_SALT`, `ADMIN_PASSWORD`, and the webhook secrets used by your integrations. Configure your public hostname in `CORS_ORIGINS` and the certificate paths in `TLS_CERT_PATH` and `TLS_KEY_PATH`.

Start the stack:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

The API applies database migrations automatically. Check the service status with:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production ps
curl -k https://your-soc-host.example/api/v1/health
```

The first start creates the account supplied through `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Remove `ADMIN_PASSWORD` from the environment after the initial login.

## Safe defaults

External integrations, cloud LLMs, deployment actions, configuration apply operations, and Wazuh false-positive apply operations are disabled by default. Enable only the components you have configured and tested.

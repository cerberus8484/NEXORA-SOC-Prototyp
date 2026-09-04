# Nexora Prototype Update Guide

Use this guide on the work server where the Nexora Prototype is installed.

Run the commands from the Nexora installation directory. This is the directory
that contains the `deploy` folder.

## 1. Confirm the repository and branch

```bash
git remote get-url origin
git branch --show-current
```

Expected values:

```text
https://github.com/cerberus8484/NEXORA-SOC-Prototyp.git
main
```

If either value differs, stop and contact the Nexora maintainer. Do not deploy
from another repository or branch.

## 2. Check for local changes

```bash
git status --short
```

Expected result: no output.

If the command prints files, do not use `git reset`, `git clean`, or any force
command. Send the complete output to the Nexora maintainer first.

## 3. Download the current Prototype version

```bash
git pull --ff-only origin main
```

This downloads only a fast-forward update and cannot silently overwrite local
commits.

## 4. Verify the frontend entry file

```bash
git ls-files frontend/index.html
```

Expected result:

```text
frontend/index.html
```

If the line is missing, stop and send the command output to the Nexora
maintainer. Do not run the deployment.

## 5. Deploy the update

```bash
./deploy/release.sh
```

The script builds the API and frontend images, starts the Nexora services, and
runs its included health checks.

Expected result: `RELEASE PASSED` or `RELEASE OK`.

## 6. Verify the running services

```bash
./deploy/soc.sh ps
```

Expected result: the web, API, and database services are running. The API and
database should report `healthy` when health checks are available.

## Do not use these commands during an update incident

```bash
docker compose down -v
docker system prune --volumes
git reset --hard
git clean -fd
```

These commands can remove persistent data or local work. Send the full error
output to the Nexora maintainer instead.

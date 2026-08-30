#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 20 — NFS-Storage (WD My Cloud) in Proxmox registrieren
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
phase_storage() {
  step "Phase 20: NFS-Storage '${PVE_STORAGE_VM}'"

  if pvesm status 2>/dev/null | grep -q "^${PVE_STORAGE_VM}\b"; then
    ok "Storage '${PVE_STORAGE_VM}' bereits registriert."
  else
    log "Registriere NFS ${NFS_SERVER}:${NFS_EXPORT} als '${PVE_STORAGE_VM}'"
    pvesm add nfs "$PVE_STORAGE_VM" \
      --server "$NFS_SERVER" \
      --export "$NFS_EXPORT" \
      --content images,iso,rootdir \
      --options vers=3 \
      || die "pvesm add nfs fehlgeschlagen — NAS erreichbar? Route ${NFS_SERVER} via ${PVE_MGMT_GW}?"
    ok "Storage hinzugefuegt."
  fi

  # Sicherstellen, dass ISO+Image-Content aktiv ist
  pvesm set "$PVE_STORAGE_VM" --content images,iso,rootdir || true

  log "Pruefe Verfuegbarkeit …"
  pvesm status | grep "$PVE_STORAGE_VM" || warn "Storage nicht 'available' — NAS/Route pruefen."

  mkdir -p "$PVE_ISO_DIR" "$PVE_IMG_DIR" 2>/dev/null || true
  ok "Phase 20 fertig."
}

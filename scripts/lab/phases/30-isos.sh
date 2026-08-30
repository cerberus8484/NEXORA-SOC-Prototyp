#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 30 — ISOs & Cloud-Images bereitstellen
#
# Laedt nur, was eine offene URL hat. Windows-Server-Eval braucht einen
# EvalCenter-Login → wird erwartet, dass die ISO manuell abgelegt ist.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# fetch <url> <zielpfad> — idempotent, ueberspringt vorhandene Dateien
_fetch() {
  local url="$1" dest="$2"
  [[ -n "$url" ]] || { warn "Keine URL fuer $(basename "$dest") — bitte manuell ablegen."; return 0; }
  if [[ -s "$dest" ]]; then ok "$(basename "$dest") vorhanden — ueberspringe."; return 0; fi
  log "Lade $(basename "$dest") …"
  wget -q --show-progress -O "${dest}.part" "$url" || die "Download fehlgeschlagen: $url"
  mv "${dest}.part" "$dest"
  ok "$(basename "$dest") geladen."
}

phase_isos() {
  step "Phase 30: ISOs & Cloud-Images"
  need_cmd wget
  mkdir -p "$PVE_ISO_DIR" "$PVE_IMG_DIR"

  # OPNsense (kommt .bz2-gepackt)
  if [[ ! -s "${PVE_ISO_DIR}/${ISO_OPNSENSE}" && -n "$ISO_OPNSENSE_URL" ]]; then
    _fetch "$ISO_OPNSENSE_URL" "${PVE_ISO_DIR}/${ISO_OPNSENSE}.bz2"
    log "Entpacke OPNsense-ISO …"; bunzip2 -f "${PVE_ISO_DIR}/${ISO_OPNSENSE}.bz2"
    ok "OPNsense-ISO bereit."
  else
    ok "OPNsense-ISO vorhanden oder keine URL."
  fi

  _fetch "$ISO_VIRTIO_URL"  "${PVE_ISO_DIR}/${ISO_VIRTIO}"
  _fetch "$IMG_UBUNTU_URL"  "${PVE_IMG_DIR}/${IMG_UBUNTU}"
  [[ -n "$IMG_KALI_URL" ]] && _fetch "$IMG_KALI_URL" "${PVE_IMG_DIR}/${IMG_KALI}"

  # Windows-Server (manuell)
  if [[ -s "${PVE_ISO_DIR}/${ISO_WINSERVER}" ]]; then
    ok "${ISO_WINSERVER} vorhanden."
  else
    warn "${ISO_WINSERVER} FEHLT. EvalCenter-Login noetig — manuell ablegen unter:"
    warn "  ${PVE_ISO_DIR}/${ISO_WINSERVER}"
    warn "  (microsoft.com/evalcenter → Windows Server 2022 → ISO)"
  fi

  ok "Phase 30 fertig."
}

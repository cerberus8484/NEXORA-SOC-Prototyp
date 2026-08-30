#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Gemeinsame Erzeugung des Admin-Temp-Passworts.
#
# Wird von ZWEI Stellen gebraucht: gen-env-production.sh (Erst-Installation) und
# install.sh --reset-admin-password (Recovery). Deshalb hier einmal — eine zweite
# Kopie wuerde irgendwann auseinanderlaufen, und ausgerechnet bei der Passwort-
# Erzeugung faellt eine schwaechere Variante nicht auf.
#
# 24 zufaellige Zeichen aus allen 4 Klassen, KEIN festes Suffix (ein konstanter
# Anhang wie "Aa1!" senkt die Entropie und triggert Hashcat-Regeln).
# Zeichensatz ohne | & / — die wuerden die sed-Ersetzung in gen-env brechen.
# Hinweis: 'head' schliesst die Pipe nach 24 Bytes → 'tr' bekommt SIGPIPE (Exit 141).
# Unter 'set -o pipefail' wuerde das die Erzeugung abbrechen → 2>/dev/null + '|| true'.
# ─────────────────────────────────────────────────────────────────────────────

nexora_gen_pw_raw() { LC_ALL=C tr -dc 'A-Za-z0-9!@#%+=' < /dev/urandom 2>/dev/null | head -c 24 || true; }

# Re-Roll, bis alle vier Zeichenklassen vertreten sind (besteht damit auch die high-Policy).
nexora_gen_admin_password() {
  local pw
  pw="$(nexora_gen_pw_raw)"
  while ! { printf '%s' "$pw" | grep -q '[A-Z]' && printf '%s' "$pw" | grep -q '[a-z]' \
         && printf '%s' "$pw" | grep -q '[0-9]' && printf '%s' "$pw" | grep -q '[!@#%+=]'; }; do
    pw="$(nexora_gen_pw_raw)"
  done
  printf '%s' "$pw"
}

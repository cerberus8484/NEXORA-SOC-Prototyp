# NEXORA SOC — Wazuh Dashboard Branding

Branding-Set für das Wazuh-Dashboard (OpenSearch Dashboards 2.x, Wazuh **4.9+**).
Ohne Reverse-Proxy, ohne externes Hosting — Logos sind als `data:`-URI eingebettet.

## Dateien
| Datei | Zweck |
|---|---|
| `logo.svg` | Wortmarke „NEXORA SOC" (Header + Login) |
| `mark.svg` | Kompaktes Symbol (zusammengeklappter Header) |
| `opensearch_dashboards.branding.yml` | Fertiger Branding-Block mit eingebetteten Logos |
| `datauris.txt` | Rohe data:-URIs (falls du sie woanders brauchst) |

## Einbau (1 — Branding)
```bash
# 1. Block ans Ende der Dashboard-Config hängen
cat opensearch_dashboards.branding.yml >> /etc/wazuh-dashboard/opensearch_dashboards.yml

# 2. Dashboard neu starten
systemctl restart wazuh-dashboard
```
Browser hart neu laden (Strg+F5). Login-Seite, Header-Logo und Tab-Titel zeigen jetzt NEXORA SOC.

> Falls der Config-Validator die `data:`-URI ablehnt (selten): die beiden SVGs per
> HTTPS hosten und `defaultUrl` auf `https://<host>/logo.svg` setzen.

## Einbau (2 — Dark Mode / Theme)
Im Dashboard: **Dashboard Management → Advanced Settings**
- `theme:darkMode` → `true`
- `theme:version` → neueste (z. B. „v9"/„Next")

## Einbau (3 — eigenes KPI-Dashboard)
Optional, größter visueller Effekt: eigenes Dashboard in der **Dashboards**-App bauen,
Severity-Farben passend setzen (Cyan `#00d4ff`, Grün, Orange, Rot), dann
**Stack Management → Saved Objects → Export** als `.ndjson` hier ablegen → versionierbar.

## Farbschema (NEXORA)
| Token | Hex |
|---|---|
| Hintergrund | `#07111f` |
| Card | `#0f1d2d` → `#0b1726` (Gradient) |
| Border | `#1e344d` |
| Akzent (Cyan) | `#00d4ff` |
| Text | `#d7e2ee` |

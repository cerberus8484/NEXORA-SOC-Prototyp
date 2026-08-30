# Provisioning Node Profiles (P_GITOPS_2)

Node-Profile beschreiben den **gewünschten Zustand** eines Nexora-Knotens (Agent/Sensor/Gateway).
Sie liegen in `nodes/*.yaml` und werden per Pull Request geändert. Design: [`docs/01-architecture/gitops-provisioning.md`](../../docs/01-architecture/gitops-provisioning.md).

> **Wichtig:** Diese YAMLs beschreiben nur Wunsch-/Zielzustand. Der Installer ist **bootstrap-only**
> und ändert **niemals** Netzwerk. Netzwerk-Apply ist ein späterer, separater Workflow
> (Preview + Approval + Rollback + Audit, disabled by default).

## Validieren (read-only, nichts wird angewendet)

```bash
node backend/scripts/validate-node-profiles.js
# oder ein anderes Verzeichnis:
node backend/scripts/validate-node-profiles.js path/to/nodes
```

Exit `0` = alle gültig · Exit `1` = mindestens ein Profil ungültig (z. B. gefährliches Feld).
Unit-Tests: `backend/tests/provisioning/validateNodeProfile.test.js`.

## Schema (Kurzreferenz)

```
node:
  name: <string, Pflicht>
  role: control_plane | normal_agent | integration_connector | network_sensor | gateway_sensor   # Pflicht
  labels: { <key>: <value> }            # optional

install:
  mode: bootstrap_only
  changeNetwork: false                  # MUSS false sein (Installer ändert nie Netzwerk)

network:
  discovery: read_only
  expectedMode: dhcp | static           # erwarteter Ist-Zustand (nur read-only erkannt)
  desiredState: { mode, managementInterface, ip, cidr, gateway, dns[] }   # ZIELzustand, nicht angewendet
  applyDuringInstall: false             # MUSS false sein

features:
  inventory | logCollection | commandConsole: <bool>
  syslogReceiver | flowCollector: { requested: <bool> }
  sniffing: { requested, interface, mode, applyDuringInstall: false, requiresApproval }   # nur network_sensor
  nat:      { requested, ..., applyDuringInstall: false, requiresApproval }                # nur gateway_sensor
  routing:  { requested, applyDuringInstall: false, requiresApproval }                     # nur gateway_sensor

safety: { previewRequired, approvalRequired, rollbackRequired, changeWindowRequired, approval{...} }

nexora:
  serverUrl: <url>
  enrollmentProfile: <name>             # Referenz, KEIN Token. Tokens kommen aus dem Backend.
```

## Sicherheits-Gates (Validierung schlägt fehl bei)

- unbekannter `role`, fehlendem `node.name`
- `install.changeNetwork` ≠ `false` · `network.applyDuringInstall` ≠ `false`
- `sniffing`/`nat`/`routing` mit `applyDuringInstall: true` (Apply nie im Installer)
- `normal_agent` mit `sniffing`/`nat`/`routing` `requested`
- `sniffing requested` außerhalb `network_sensor` · `nat`/`routing requested` außerhalb `gateway_sensor`
- Secret-verdächtige Schlüssel im YAML (`*token*`, `*password*`, `*secret*`, `*apiKey*`, …)

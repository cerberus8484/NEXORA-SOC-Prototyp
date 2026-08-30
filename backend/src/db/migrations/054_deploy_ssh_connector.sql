-- 054_deploy_ssh_connector.sql
-- Deployment Center: SSH-Connector (agent-install / Linux-Client) in derselben
-- Connector-Tabelle wie die Hypervisor-Connectoren ablegen (ein generisches
-- getConnector deckt beide Typen ab). SSH-Connectoren tragen KEIN api_token/
-- target_node, dafür verschlüsselten privateKey/passphrase + Host-Key-Pin.
--
-- privateKey/passphrase liegen NUR verschlüsselt (enc:v1: / AES-256-GCM) — nie Klartext.
-- host_key_pin ist der SHA-256-Fingerprint des Server-Host-Keys (öffentlich, kein Secret).

-- api_token_enc / target_node sind für SSH-Connectoren nicht anwendbar → nullable.
ALTER TABLE hypervisor_connectors ALTER COLUMN api_token_enc DROP NOT NULL;
ALTER TABLE hypervisor_connectors ALTER COLUMN target_node   DROP NOT NULL;

-- SSH-spezifische Spalten (nullable; nur bei type='ssh' befüllt).
ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS ssh_user        TEXT;
ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS ssh_port        INTEGER;
ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS private_key_enc TEXT;   -- enc:v1:… — NIE Klartext
ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS passphrase_enc  TEXT;   -- enc:v1:… — NIE Klartext
ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS host_key_pin    TEXT;   -- SHA-256-Hex des Host-Keys (öffentlich)

-- Defense-in-Depth (zweite Linie hinter Joi + Domain): pro Typ müssen die jeweils
-- typspezifischen Pflichtfelder gesetzt sein. Schützt gegen künftige Schreibpfade,
-- die die Anwendungs-Validierung umgehen. Idempotent (nur anlegen, falls nicht da).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_connector_type_fields') THEN
    ALTER TABLE hypervisor_connectors ADD CONSTRAINT chk_connector_type_fields CHECK (
      (type = 'proxmox' AND api_token_enc IS NOT NULL AND target_node IS NOT NULL)
      OR (type = 'ssh' AND private_key_enc IS NOT NULL AND host_key_pin IS NOT NULL)
    );
  END IF;
END $$;


-- Slice 6a (Windows-Server Live-Auth): gepinnter SSH-Host-Key eines verwalteten Nodes.
-- SHA-256 (hex). Wird nach dem Deploy per Auto-Capture (ssh-keyscan, Option 1) gesetzt
-- bzw. beim Scharfschalten-für-Updates vom Admin bestätigt (Option 2). Basis für den
-- Update-Runner (Host-Key-Pinning, kein TOFU). NULL = noch nicht erfasst.
ALTER TABLE installed_nodes ADD COLUMN IF NOT EXISTS host_key_pin TEXT;

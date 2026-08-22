ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS tls_certificate_pem TEXT;
ALTER TABLE hypervisor_connectors ADD COLUMN IF NOT EXISTS tls_certificate_fingerprint TEXT;

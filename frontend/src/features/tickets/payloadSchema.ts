// Payload-Schema — portiert aus dem Ursprungs-Tool (index.html, PAYLOAD_SCHEMA).
// Definiert pro Artefakt-Typ die Eingabefelder des Payload-Editors.

export interface PayloadFieldDef {
  key: string;
  label: string;
  input: 'text' | 'textarea';
  mono?: boolean;
  full?: boolean;
  placeholder?: string;
}

export interface TicketPayloadItem {
  id: string;
  type: string;
  raw: string;
  fields: Record<string, string>;
  createdAt: string;
}

const f = (key: string, label: string, input: 'text' | 'textarea', opts: Partial<PayloadFieldDef> = {}): PayloadFieldDef =>
  ({ key, label, input, ...opts });

export const PAYLOAD_SCHEMA: Record<string, PayloadFieldDef[]> = {
  URL: [
    f('url', 'URL', 'text', { mono: true, full: true, placeholder: 'https://malicious.example.com/payload.exe' }),
    f('method', 'Method', 'text', { placeholder: 'GET / POST / PUT' }),
    f('status', 'Status Code', 'text', { mono: true, placeholder: '200 / 302 / 403' }),
    f('referrer', 'Referrer', 'text', { mono: true, placeholder: 'https://…' }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, woher, wie gefunden …' }),
  ],
  Domain: [
    f('domain', 'Domain', 'text', { mono: true, full: true, placeholder: 'evil-domain.ru' }),
    f('resolved', 'Resolved IP', 'text', { mono: true, placeholder: '1.2.3.4' }),
    f('asn', 'ASN / ISP', 'text', { placeholder: 'AS12345 ExampleISP' }),
    f('seen', 'First Seen', 'text', { placeholder: '2026-01-15 08:32 UTC' }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, Registrar, WHOIS …' }),
  ],
  IP: [
    f('ip', 'IP-Adresse', 'text', { mono: true, placeholder: '185.220.101.5' }),
    f('geo', 'Geo / Land', 'text', { placeholder: 'DE / RU / CN' }),
    f('asn', 'ASN / ISP', 'text', { placeholder: 'AS12345 Hosting Provider' }),
    f('rep', 'Reputation', 'text', { placeholder: 'Malicious / Tor Exit / Clean' }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, Threat Intel …' }),
  ],
  File: [
    f('filename', 'Dateiname', 'text', { mono: true, full: true, placeholder: 'invoice_april.exe' }),
    f('path', 'Pfad', 'text', { mono: true, full: true, placeholder: 'C:\\Users\\jdoe\\AppData\\Temp\\…' }),
    f('size', 'Größe', 'text', { mono: true, placeholder: '1.4 MB / 1482763 bytes' }),
    f('hash', 'Hash (MD5/SHA256)', 'text', { mono: true, full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Woher, Kontext, wie gefunden …' }),
  ],
  Script: [
    f('filename', 'Dateiname', 'text', { mono: true, placeholder: 'dropper.ps1' }),
    f('lang', 'Sprache', 'text', { placeholder: 'PowerShell / Python / VBScript / Batch' }),
    f('snippet', 'Snippet / Inhalt', 'textarea', { mono: true, full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, Obfuscation, Encoding …' }),
  ],
  Command: [
    f('shell', 'Shell', 'text', { mono: true, placeholder: 'cmd.exe / PowerShell / bash' }),
    f('runas', 'Run As', 'text', { mono: true, placeholder: 'SYSTEM / DOMAIN\\jdoe' }),
    f('cmd', 'Vollständiger Befehl', 'textarea', { mono: true, full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, Elternteil-Prozess …' }),
  ],
  Email: [
    f('sender', 'Absender', 'text', { mono: true, full: true, placeholder: 'phishing@fake-bank.de' }),
    f('subject', 'Betreff', 'text', { full: true }),
    f('attach', 'Anhang', 'text', { mono: true, placeholder: 'invoice_2026.zip / .docm' }),
    f('origip', 'Originating IP', 'text', { mono: true }),
    f('header', 'Header Info', 'textarea', { mono: true, full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Phishing-Kampagne, Ziel, Kontext …' }),
  ],
  'Registry-Key': [
    f('key', 'Key-Pfad', 'text', { mono: true, full: true, placeholder: 'HKCU\\Software\\…\\Run\\updater' }),
    f('valname', 'Value-Name', 'text', { mono: true }),
    f('valdata', 'Value-Data', 'text', { mono: true, full: true }),
    f('action', 'Aktion', 'text', { placeholder: 'Created / Modified / Deleted' }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Persistence-Mechanismus, Kontext …' }),
  ],
  'User-Agent': [
    f('ua', 'User-Agent String', 'text', { mono: true, full: true }),
    f('tool', 'Zugehöriges Tool', 'text', { placeholder: 'Cobalt Strike / Metasploit / curl' }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, erkannte Kampagne …' }),
  ],
  Hash: [
    f('algo', 'Algorithmus', 'text', { placeholder: 'MD5 / SHA1 / SHA256 / SSDEEP' }),
    f('hashval', 'Hashwert', 'text', { mono: true, full: true }),
    f('filename', 'Dateiname', 'text', { mono: true }),
    f('vt', 'VirusTotal / TI Link', 'text', { full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Detections, AV-Ergebnis …' }),
  ],
  'Encoded String': [
    f('encoding', 'Encoding', 'text', { placeholder: 'Base64 / Hex / URL-Encode / XOR' }),
    f('encoded', 'Encoded Value', 'textarea', { mono: true, full: true }),
    f('decoded', 'Decoded Value', 'textarea', { mono: true, full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext, wie dekodiert …' }),
  ],
  Andere: [
    f('label', 'Label / Bezeichnung', 'text', { placeholder: 'z.B. Cookie, Token, Certificate …' }),
    f('value', 'Wert', 'textarea', { mono: true, full: true }),
    f('notes', 'Notizen', 'textarea', { full: true, placeholder: 'Kontext …' }),
  ],
};

export const PAYLOAD_TYPES = Object.keys(PAYLOAD_SCHEMA);

/** Payload → Anzeigeform für den Template-Generator ({label, value}-Paare). */
export function payloadToTemplateFields(p: TicketPayloadItem): { label: string; value: string }[] {
  const schema = PAYLOAD_SCHEMA[p.type] ?? [];
  return schema.map((def) => ({ label: def.label, value: p.fields[def.key] ?? '' }));
}

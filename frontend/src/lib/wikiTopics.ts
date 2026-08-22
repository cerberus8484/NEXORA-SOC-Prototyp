// Zentrale Themen-Registry fuer Tooltips: pro konfigurierbarer Funktion ein kurzer Hinweis
// plus ein interner Wiki-Slug. Komponenten referenzieren nur den Topic-Key.

export interface WikiTopic {
  hint: string;
  slug: string;
}

export const WIKI_TOPICS = {
  integrationen: {
    hint: 'Externe Quellen anbinden und ihren Zustand ueberwachen. Endpunkt und Zugangsdaten setzen, dann Verbindung testen.',
    slug: 'admin/integrationen',
  },
  wazuh: {
    hint: 'Wazuh ist die Primaerquelle fuer Alerts, Agents und Telemetrie. Endpunkt, API-Zugang und Webhook-Secret sauber hinterlegen.',
    slug: 'admin/integrationen',
  },
  'threat-intel': {
    hint: 'Threat-Intel reichert IPs, Hashes und Domains an. API-Key setzen und die Verbindung pruefen.',
    slug: 'admin/integrationen',
  },
  sicherheit: {
    hint: 'Authentifizierung, MFA, Session-Haertung und Passwort-Richtlinien. Sicherheitsaenderungen nur bewusst vornehmen.',
    slug: 'admin/sicherheit',
  },
  oidc: {
    hint: 'Single Sign-On ueber einen OIDC-Provider. Discovery-URL, Client-ID und Secret exakt eintragen.',
    slug: 'admin/sicherheit',
  },
  mfa: {
    hint: 'Zwei-Faktor per TOTP-App. Als Pflicht erzwingt die Organisation die Einrichtung beim naechsten Login.',
    slug: 'admin/sicherheit',
  },
  'benutzer-rollen': {
    hint: 'Benutzer anlegen und Rollen sauber vergeben. Rechte nur nach Aufgabe, nicht nach Bauchgefuehl.',
    slug: 'admin/benutzer-und-rollen',
  },
  'ki-agent': {
    hint: 'LLM-Provider und Triage-Verhalten der KI. Die KI hilft, trifft aber nicht blind Entscheidungen.',
    slug: 'admin/ki-agent',
  },
  benachrichtigungen: {
    hint: 'E-Mail- oder Webhook-Benachrichtigungen bei wichtigen Ereignissen. Erst klein konfigurieren, dann testen.',
    slug: 'admin/benachrichtigungen',
  },
  retention: {
    hint: 'Aufbewahrungsfristen fuer Tickets, Evidence und Audit-Daten. Nicht verkuerzen, ohne die Folgen zu verstehen.',
    slug: 'admin/speicherung-retention',
  },
  branding: {
    hint: 'Anzeigename, Farben und visuelle Darstellung der Instanz. Lesbarkeit ist wichtiger als Deko.',
    slug: 'admin/branding',
  },
  audit: {
    hint: 'Audit-Log fuer sicherheitsrelevante Aktionen. Hilft beim Nachvollziehen, nicht beim Raten.',
    slug: 'admin/audit-compliance',
  },
  autonomy: {
    hint: 'Autonomie-Richtlinien legen fest, was automatisch vorgeschlagen oder freigegeben werden darf.',
    slug: 'admin/autonomy-policies',
  },
  provisioning: {
    hint: 'Nodes und Agents kontrolliert registrieren und ausrollen. Keine Schnellschuesse bei schreibenden Aktionen.',
    slug: 'admin/provisioning',
  },
  correlation: {
    hint: 'Die Correlation Engine fuehrt Signale zusammen. Kleine Aenderungen sind besser als grobe Schwellenwechsel.',
    slug: 'admin/correlation-engine',
  },
  'api-webhooks': {
    hint: 'API-Token und Webhook-Eingaenge sind nachvollziehbar und sensibel. Sauber dokumentieren und pruefen.',
    slug: 'admin/audit-compliance',
  },
  mitre: {
    hint: 'MITRE hilft beim Einordnen der Abdeckung. Das ist eher Kontext als taegliche Bedienung.',
    slug: 'bedienung/detections',
  },
  hunts: {
    hint: 'Threat-Hunting-Sessions gegen einen Host oder Verdacht starten. Erst Hypothese, dann Hunt.',
    slug: 'bedienung/hunts',
  },
  'use-case-developer': {
    hint: 'Use Cases und Detection-Ideen strukturiert entwickeln. Nicht mit hektischen Direkt-Aenderungen verwechseln.',
    slug: 'bedienung/detections',
  },
  containment: {
    hint: 'Containment ist eine bewusste Reaktion auf ein Zielsystem. Nichts davon sollte gedankenlos passieren.',
    slug: 'bedienung/deployment-center',
  },
  services: {
    hint: 'Hier steuerst du bereits eingerichtete Dienste. Erst Ursache verstehen, dann eventuell neu starten.',
    slug: 'admin/services',
  },
  tickets: {
    hint: 'Die zentrale Fallliste. Erst lesen, dann priorisieren und erst danach bearbeiten.',
    slug: 'bedienung/tickets',
  },
  evidence: {
    hint: 'Gesammelte Beweise mit nachvollziehbarer Kette. Nicht nur die Zusammenfassung lesen.',
    slug: 'bedienung/evidence',
  },
  hosts: {
    hint: 'Alle ueberwachten Rechner. Hostdaten sind Kontext fuer Tickets, nicht automatisch ein Schuldspruch.',
    slug: 'bedienung/hosts',
  },
  detection: {
    hint: 'Uebersicht aktiver Erkennungen. Regeln erst verstehen, dann bewerten.',
    slug: 'bedienung/detections',
  },
  'soc-metrics': {
    hint: 'Kennzahlen zum SOC-Betrieb. Zahlen nie ohne Kontext lesen.',
    slug: 'bedienung/soc-metriken',
  },
  dataplane: {
    hint: 'Die Datenpipeline vor den Tickets. Gut, um Eingangsprobleme von Bearbeitungsproblemen zu unterscheiden.',
    slug: 'bedienung/systemstatus',
  },
  yara: {
    hint: 'YARA-Signaturen fuer Datei- und Speicherpruefungen. Eher ein Werkzeug fuer erfahrene Nutzer.',
    slug: 'bedienung/yara',
  },
  qradar: {
    hint: 'QRadar-Offenses ansehen und bei Bedarf nach Nexora uebernehmen.',
    slug: 'bedienung/qradar',
  },
  nis2: {
    hint: 'Readiness statt Magie: zeigt Nachweise und Luecken fuer NIS2-nahe Themen.',
    slug: 'bedienung/nis2',
  },
  system: {
    hint: 'Gesundheit der Dienste und Integrationen auf einen Blick. Erster Halt bei komischem Verhalten.',
    slug: 'bedienung/systemstatus',
  },
  deploy: {
    hint: 'Deployment-Center fuer kontrollierte technische Aktionen. Nicht fuer normale Triage gedacht.',
    slug: 'bedienung/deployment-center',
  },
  profile: {
    hint: 'Dein eigenes Konto: Passwort und MFA fuer dich selbst verwalten.',
    slug: 'admin/sicherheit',
  },
} as const satisfies Record<string, WikiTopic>;

export type WikiTopicKey = keyof typeof WIKI_TOPICS;

export function getWikiTopic(key: WikiTopicKey): WikiTopic {
  return WIKI_TOPICS[key];
}

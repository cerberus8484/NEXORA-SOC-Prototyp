export interface WikiManualSection {
  title: string;
  body: string;
  steps?: string[];
  bullets?: string[];
}

export interface WikiManualPage {
  slug: string;
  title: string;
  summary: string;
  audience: string;
  goal: string;
  beforeYouStart: string[];
  sections: WikiManualSection[];
  related?: string[];
}

export interface WikiManualGroup {
  id: string;
  title: string;
  description: string;
  slugs: string[];
}

export const WIKI_MANUAL_GROUPS: WikiManualGroup[] = [
  {
    id: 'start',
    title: 'Schnell starten',
    description: 'Fuer neue Kollegen: erst verstehen, dann klicken.',
    slugs: ['start/erste-schritte', 'bedienung/tickets', 'bedienung/evidence'],
  },
  {
    id: 'daily',
    title: 'Taegliche Bedienung',
    description: 'Die Seiten, die Analysten im Alltag wirklich nutzen.',
    slugs: ['bedienung/tickets', 'bedienung/evidence', 'bedienung/hosts', 'bedienung/hunts', 'bedienung/systemstatus'],
  },
  {
    id: 'admin',
    title: 'Administration',
    description: 'Funktionen fuer Admins und Engineers mit klaren Schritten.',
    slugs: ['admin/integrationen', 'admin/sicherheit', 'admin/benutzer-und-rollen', 'admin/ki-agent', 'admin/benachrichtigungen', 'admin/speicherung-retention', 'admin/branding', 'admin/services'],
  },
  {
    id: 'advanced',
    title: 'Fortgeschrittene Themen',
    description: 'Nur oeffnen, wenn du die Grundfunktionen schon sicher beherrschst.',
    slugs: ['bedienung/detections', 'bedienung/yara', 'bedienung/qradar', 'bedienung/deployment-center', 'admin/provisioning', 'admin/correlation-engine', 'admin/autonomy-policies', 'bedienung/nis2'],
  },
];

export const WIKI_MANUAL_PAGES: WikiManualPage[] = [
  {
    slug: 'start/erste-schritte',
    title: 'Erste Schritte in Nexora',
    summary: 'Diese Seite erklärt, wie du dich in Nexora orientierst, ohne etwas kaputt zu machen.',
    audience: 'Neue Analysten, neue Admins, Vertretungen',
    goal: 'Du sollst nach 5 Minuten wissen, wo du schauen musst und was du besser nicht sofort änderst.',
    beforeYouStart: [
      'Wenn du nur lesen willst, starte mit Dashboard, Tickets und Evidence Center.',
      'Wenn du Systemeinstellungen ändern willst, prüfe zuerst deine Rolle und ob du wirklich im richtigen Bereich bist.',
      'Schreibende Admin-Funktionen immer bewusst ausfuehren. Nexora ist kein Spielplatz.',
    ],
    sections: [
      {
        title: 'So denkst du ueber Nexora',
        body: 'Nexora sammelt und korreliert Sicherheitsdaten. Du arbeitest fast immer in dieser Reihenfolge: Lage ansehen, Ticket prüfen, Evidence bestätigen, nächste Aktion festlegen.',
        bullets: [
          'Dashboard = schneller Ueberblick',
          'Tickets = Faelle bearbeiten',
          'Evidence Center = Beweise pruefen',
          'Hosts = betroffene Systeme nachsehen',
        ],
      },
      {
        title: 'Die ersten 4 Klicks für neue Nutzer',
        body: 'Wenn du das System zum ersten Mal öffnest, arbeite exakt diese Reihenfolge ab.',
        steps: [
          'Dashboard öffnen und schauen, ob gerade rote oder hohe Prioritäten sichtbar sind.',
          'Tickets öffnen und nach Status oder Priorität filtern.',
          'Ein Ticket anklicken und lesen, ob schon Evidence oder Analyse vorhanden ist.',
          'Danach ins Evidence Center wechseln und prüfen, ob die Belege nachvollziehbar sind.',
        ],
      },
      {
        title: 'Womit du nicht anfangen solltest',
        body: 'Viele neue Nutzer springen sofort in Settings, KI oder Deployment. Das führt fast immer zu Unsicherheit.',
        bullets: [
          'Nicht zuerst an Integrationen drehen, wenn du nur einen Alarm verstehen willst.',
          'Nicht zuerst KI-Einstellungen ändern, wenn du die normale Triage noch nicht kennst.',
          'Nicht zuerst Services neu starten, nur weil Daten fehlen.',
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/evidence', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/integrationen',
    title: 'Integrationen einrichten',
    summary: 'Hier verbindest du externe Quellen wie Wazuh, Threat-Intel, Mail oder weitere Datenlieferanten.',
    audience: 'Admins, Engineers',
    goal: 'Eine Quelle sauber anbinden, testen und erst dann produktiv nutzen.',
    beforeYouStart: [
      'Halte URL, Benutzername, API-Key oder Secret bereit.',
      'Aendere immer nur eine Integration auf einmal.',
      'Nach jeder Aenderung zuerst Verbindung testen, dann speichern.',
    ],
    sections: [
      {
        title: 'Wofuer diese Seite da ist',
        body: 'Diese Seite ist keine Alarmansicht. Sie ist nur dafuer da, Quellen an Nexora anzubinden und ihren Zustand zu pruefen.',
        bullets: [
          'Wazuh fuer Alerts, Agents und Telemetrie',
          'Threat-Intel fuer Anreicherung',
          'Webhook- oder Mail-Quellen fuer Eingangsdaten',
        ],
      },
      {
        title: 'So richtest du eine Quelle sauber ein',
        body: 'Arbeite die Schritte nacheinander ab und ueberspringe nichts.',
        steps: [
          'Die gewuenschte Integration auswaehlen.',
          'Endpunkt und Zugangsdaten eintragen.',
          'Auf Verbindung testen klicken und die Rueckmeldung lesen.',
          'Nur wenn der Test erfolgreich ist: speichern.',
          'Danach Tickets oder Collector-Status pruefen, ob wirklich Daten ankommen.',
        ],
      },
      {
        title: 'Typische Fehler',
        body: 'Die meisten Probleme kommen nicht von Nexora, sondern von kleinen Eingabefehlern.',
        bullets: [
          'Falsche URL oder falsches Protokoll',
          'API-Key vergessen oder mit Leerzeichen kopiert',
          'Quelle liefert technisch Daten, aber an den falschen Endpunkt',
        ],
      },
    ],
    related: ['bedienung/systemstatus', 'bedienung/qradar'],
  },
  {
    slug: 'admin/sicherheit',
    title: 'Sicherheit einstellen',
    summary: 'Hier verwaltest du Passwortregeln, MFA, Session-Haertung und Zugriffsschutz.',
    audience: 'Admins',
    goal: 'Sicherheit erhoehen, ohne Nutzer auszusperren.',
    beforeYouStart: [
      'Aendere Security-Settings nur mit Plan und moeglichst nicht mitten in einer Stoerung.',
      'Wenn du IP-Allowlist oder TLS anfasst, pruefe vorher deinen eigenen Rueckweg.',
      'Bei groesseren Aenderungen einen zweiten Admin informieren.',
    ],
    sections: [
      {
        title: 'Erst verstehen, dann speichern',
        body: 'Diese Seite enthaelt echte, wirksame Sicherheitseinstellungen. Ein falscher Klick kann den Login fuer andere erschweren.',
        bullets: [
          'Passwort-Policy = wie stark Passwoerter sein muessen',
          'MFA = zweiter Faktor per TOTP',
          'Session-Regeln = wie lange Nutzer angemeldet bleiben',
          'Allowlist = wer ueberhaupt auf die Plattform kommt',
        ],
      },
      {
        title: 'Sicheres Vorgehen bei Aenderungen',
        body: 'Aendere immer nur einen Block und teste danach sofort.',
        steps: [
          'Vor dem Aendern notieren, was aktuell gesetzt ist.',
          'Genau eine Einstellung oder einen kleinen Block anpassen.',
          'Speichern.',
          'Mit einem Testnutzer oder in einem zweiten Browser pruefen, ob Login und Zugriff noch funktionieren.',
          'Erst danach den naechsten Block aendern.',
        ],
      },
      {
        title: 'Besondere Vorsicht',
        body: 'Einige Felder sind hochsensibel und koennen dich selbst aussperren.',
        bullets: [
          'IP-Allowlist nur pflegen, wenn du die Quellnetze wirklich kennst.',
          'MFA-Pflicht nur einschalten, wenn Nutzer vorbereitet sind.',
          'Session-Limits nicht zu aggressiv setzen, sonst stoerst du den Betrieb.',
        ],
      },
    ],
    related: ['admin/benutzer-und-rollen', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/benutzer-und-rollen',
    title: 'Benutzer und Rollen',
    summary: 'Hier legst du fest, wer was sehen und tun darf.',
    audience: 'Admins',
    goal: 'Zugriffe sauber vergeben, ohne zu viel oder zu wenig Rechte zu geben.',
    beforeYouStart: [
      'Lege neue Nutzer moeglichst mit der kleinsten noetigen Rolle an.',
      'Aendere Rollen bewusst und dokumentiert.',
      'Bei Unsicherheit lieber erst Analyst statt Admin vergeben.',
    ],
    sections: [
      {
        title: 'So liest du Rollen richtig',
        body: 'Rollen sind kein Titel, sondern ein Berechtigungspaket. Mehr Rechte bedeuten mehr Risiko.',
        bullets: [
          'Analyst = operativ arbeiten',
          'Engineer = technische Fachfunktionen',
          'Admin = Einstellungen, Sicherheit, kritische Bedienung',
        ],
      },
      {
        title: 'Neuen Nutzer anlegen',
        body: 'Bleib bei einer einfachen, sicheren Reihenfolge.',
        steps: [
          'Benutzerbereich oeffnen.',
          'Nutzer mit korrekter Mail-Adresse oder Kennung anlegen.',
          'Die kleinste passende Rolle vergeben.',
          'Speichern.',
          'Mit dem Nutzer pruefen, ob die benoetigten Seiten sichtbar sind.',
        ],
      },
      {
        title: 'Wenn jemand "alles sehen" will',
        body: 'Dann ist meistens die Anforderung noch nicht sauber. Mehr Rechte nur mit Grund.',
        bullets: [
          'Fragen: Welche Aufgabe soll erledigt werden?',
          'Pruefen: Reicht Analyst oder Engineer?',
          'Admin nur, wenn wirklich Systemfunktionen geaendert werden muessen.',
        ],
      },
    ],
    related: ['admin/sicherheit', 'start/erste-schritte'],
  },
  {
    slug: 'admin/ki-agent',
    title: 'KI Agent verstehen und einstellen',
    summary: 'Diese Seite erklaert, was die KI in Nexora darf und was bewusst nicht automatisch passiert.',
    audience: 'Admins, Engineers',
    goal: 'Die KI so einstellen, dass sie hilft, aber keine falsche Sicherheit erzeugt.',
    beforeYouStart: [
      'Die KI ist Unterstuetzung, kein Ersatz fuer Analysten.',
      'Human Approval bleibt wichtig.',
      'Aendere Provider oder Policies nicht waehrend eines kritischen Incidents.',
    ],
    sections: [
      {
        title: 'Was die KI hier tun soll',
        body: 'Die KI bewertet, strukturiert und priorisiert. Sie soll Arbeit vorbereiten, nicht blind Entscheidungen treffen.',
        bullets: [
          'Triage-Vorschlaege erzeugen',
          'Kontext zusammenfassen',
          'Hinweise fuer den naechsten Schritt geben',
        ],
      },
      {
        title: 'Sicher einstellen',
        body: 'Wenn du an der KI schraubst, geh konservativ vor.',
        steps: [
          'Provider und Modus pruefen.',
          'Schwellen oder Policies nur in kleinen Schritten aendern.',
          'Nach der Aenderung Eval oder Testfall anschauen.',
          'Erst dann den Betrieb weiterlaufen lassen.',
        ],
      },
      {
        title: 'Woran du gute KI-Einstellungen erkennst',
        body: 'Gut ist nicht maximal aggressiv, sondern nachvollziehbar und stabil.',
        bullets: [
          'Wenig falsche Freigaben',
          'Klare Begruendung fuer Vorschlaege',
          'Keine stillen Automatismen ohne Gate',
        ],
      },
    ],
    related: ['admin/autonomy-policies', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/benachrichtigungen',
    title: 'Benachrichtigungen',
    summary: 'Hier legst du fest, wer bei welchen Ereignissen informiert wird.',
    audience: 'Admins',
    goal: 'Wichtige Meldungen zustellen, ohne alle mit Spam zu ueberfluten.',
    beforeYouStart: [
      'Erst festlegen, welche Ereignisse wirklich wichtig sind.',
      'Nur die notwendigen Empfaenger eintragen.',
      'Nach dem Einrichten immer testen.',
    ],
    sections: [
      {
        title: 'Wofuer diese Seite gedacht ist',
        body: 'Benachrichtigungen sollen Menschen gezielt aufmerksam machen, nicht ununterbrochen stoeren.',
        bullets: [
          'Kritische Tickets',
          'Statuswechsel',
          'Betriebs- oder Sicherheitsereignisse',
        ],
      },
      {
        title: 'Sauber einrichten',
        body: 'So vermeidest du doppelte oder nutzlose Meldungen.',
        steps: [
          'Kanal waehlen, zum Beispiel E-Mail.',
          'Empfaenger definieren.',
          'Nur relevante Ausloeser aktivieren.',
          'Test senden.',
          'Rueckmeldung mit einem echten Empfaenger pruefen.',
        ],
      },
      {
        title: 'Was du vermeiden solltest',
        body: 'Zu viele Mails fuehren dazu, dass irgendwann niemand mehr hinschaut.',
        bullets: [
          'Jedes kleine Event an alle schicken',
          'Mehrere Kanaele fuer denselben Zweck doppelt benutzen',
          'Warnungen ohne klaren Handlungsbedarf aktivieren',
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/speicherung-retention',
    title: 'Speicherung und Retention',
    summary: 'Hier steuerst du, wie lange Daten aufbewahrt werden und was spaeter verschwindet.',
    audience: 'Admins',
    goal: 'Genug Daten fuer den Betrieb behalten, aber keine unnoetigen Altlasten stapeln.',
    beforeYouStart: [
      'Pruefe zuerst, welche Datenarten betroffen sind.',
      'Aufbewahrung nicht aus dem Bauch heraus verkuerzen.',
      'Bei Audit- oder Compliance-Daten besonders vorsichtig sein.',
    ],
    sections: [
      {
        title: 'Was hier geregelt wird',
        body: 'Retention bedeutet: Daten bleiben nicht endlos liegen, sondern folgen Regeln.',
        bullets: [
          'Tickets',
          'Evidence',
          'Audit-Eintraege',
          'weitere Betriebsdaten',
        ],
      },
      {
        title: 'Sicheres Vorgehen',
        body: 'Aendere Fristen nur, wenn du verstehst, wen das spaeter trifft.',
        steps: [
          'Betroffene Datenart auswaehlen.',
          'Aktuelle Frist notieren.',
          'Neue Frist setzen.',
          'Pruefen, ob es rechtliche oder betriebliche Gruende gegen die Aenderung gibt.',
          'Speichern und teamintern kommunizieren.',
        ],
      },
      {
        title: 'Typischer Denkfehler',
        body: 'Weniger Speicher ist nicht automatisch besser. Fehlt spaeter Evidence, ist der Schaden groesser als ein paar Gigabyte.',
      },
    ],
    related: ['bedienung/evidence', 'admin/audit-compliance'],
  },
  {
    slug: 'admin/branding',
    title: 'Branding und Thema',
    summary: 'Hier passt du Namen, Farben und Darstellung der Instanz an.',
    audience: 'Admins',
    goal: 'Die Plattform an eure Umgebung anpassen, ohne Lesbarkeit zu verlieren.',
    beforeYouStart: [
      'Nur Farben waehlen, die in Hell und Dunkel gut lesbar bleiben.',
      'Markenname konsistent schreiben.',
      'Visuelle Aenderungen erst pruefen, dann breit ausrollen.',
    ],
    sections: [
      {
        title: 'Was diese Seite veraendert',
        body: 'Branding ist rein Darstellung. Es aendert nicht die Sicherheitslogik oder die Daten.',
        bullets: [
          'Plattformname',
          'Akzentfarbe',
          'Logo oder visuelle Kennzeichen',
        ],
      },
      {
        title: 'So gehst du vor',
        body: 'Lieber wenig und sauber als bunt und unruhig.',
        steps: [
          'Name oder Farbe aendern.',
          'Vorschau pruefen.',
          'Achte auf Kontrast in Buttons, Labels und Headern.',
          'Erst dann speichern.',
        ],
      },
    ],
    related: ['start/erste-schritte'],
  },
  {
    slug: 'admin/services',
    title: 'Services neu starten',
    summary: 'Hier steuerst du bestehende Dienste. Das ist ein Betriebswerkzeug, kein Bastelbereich.',
    audience: 'Admins',
    goal: 'Nur dann eingreifen, wenn du wirklich weisst, warum.',
    beforeYouStart: [
      'Erst pruefen, ob der Fehler wirklich vom Dienst kommt.',
      'Wenn moeglich Grund dokumentieren.',
      'Neustart nie aus Langeweile oder auf Verdacht.',
    ],
    sections: [
      {
        title: 'Wofuer die Seite da ist',
        body: 'Du legst hier keine neuen Services an. Du steuerst vorhandene Dienste kontrolliert und nachvollziehbar.',
      },
      {
        title: 'Neustart in sicherer Reihenfolge',
        body: 'Diese Reihenfolge verhindert hektische Fehlbedienung.',
        steps: [
          'Service identifizieren.',
          'Pruefen, ob Systemstatus oder Logs wirklich auf diesen Dienst zeigen.',
          'Falls verlangt: scharfschalten oder bestaetigen.',
          'Neustart ausloesen.',
          'Danach Systemstatus und Funktion pruefen.',
        ],
      },
      {
        title: 'Wann du keinen Neustart machen solltest',
        body: 'Ein Neustart loest keine falsche Konfiguration und keine fehlenden Zugangsdaten.',
        bullets: [
          'Wenn nur eine Integration falsch eingetragen ist',
          'Wenn Benutzerrechte fehlen',
          'Wenn du die Ursache noch gar nicht kennst',
        ],
      },
    ],
    related: ['bedienung/systemstatus', 'admin/integrationen'],
  },
  {
    slug: 'admin/autonomy-policies',
    title: 'Autonomy Policies',
    summary: 'Hier definierst du, welche automatischen Vorschlaege oder Reaktionen ueberhaupt erlaubt sind.',
    audience: 'Admins',
    goal: 'Automatisierung kontrollieren, nicht entfesseln.',
    beforeYouStart: [
      'Nur aendern, wenn du die Auswirkungen auf den Betrieb kennst.',
      'Human-in-the-loop bleibt der sichere Standard.',
      'Aenderungen immer mit Review denken.',
    ],
    sections: [
      {
        title: 'Was eine Policy tut',
        body: 'Policies sagen nicht nur Ja oder Nein. Sie setzen Grenzen, Bedingungen und noetige Freigaben.',
      },
      {
        title: 'Sicheres Vorgehen',
        body: 'Hier sind kleine Schritte Pflicht.',
        steps: [
          'Aktuelle Policy lesen.',
          'Nur einen Teilbereich anpassen.',
          'Aenderung speichern.',
          'Mit Testfaellen oder Eval pruefen.',
          'Erst danach weitere Regeln anfassen.',
        ],
      },
      {
        title: 'Einfacher Merksatz',
        body: 'Wenn du nicht klar erklaeren kannst, warum eine Automation erlaubt sein soll, dann ist sie noch nicht bereit.',
      },
    ],
    related: ['admin/ki-agent'],
  },
  {
    slug: 'admin/provisioning',
    title: 'Provisioning',
    summary: 'Hier registrierst und verwaltest du Nodes oder Agents fuer den kontrollierten Rollout.',
    audience: 'Admins, Engineers',
    goal: 'Neue Systeme sauber aufnehmen, ohne Wildwuchs zu erzeugen.',
    beforeYouStart: [
      'Pruefe immer, ob das Zielsystem wirklich fuer Nexora vorgesehen ist.',
      'Halte Namen und technische Zuordnung sauber.',
      'Rollouts nicht parallel chaotisch starten.',
    ],
    sections: [
      {
        title: 'Wofuer diese Seite da ist',
        body: 'Provisioning bedeutet: einen Knoten geordnet ins System aufnehmen, nicht einfach irgendwo Software hinwerfen.',
      },
      {
        title: 'Standardablauf',
        body: 'So bleibt der Rollout nachvollziehbar.',
        steps: [
          'Node oder Agent registrieren.',
          'Zuordnung und Metadaten pruefen.',
          'Notwendige Freigaben oder Tokens erzeugen.',
          'Installation oder Enrollment auf dem Zielsystem ausfuehren.',
          'Heartbeat oder Status kontrollieren.',
        ],
      },
    ],
    related: ['bedienung/hosts', 'bedienung/deployment-center'],
  },
  {
    slug: 'admin/correlation-engine',
    title: 'Correlation Engine',
    summary: 'Hier steuerst du, wie einzelne Signale zu einem groesseren Vorfall zusammengezogen werden.',
    audience: 'Admins, Engineers',
    goal: 'Weniger Rauschen, mehr brauchbare Zusammenhaenge.',
    beforeYouStart: [
      'Nur anpassen, wenn du das aktuelle Problem wirklich verstanden hast.',
      'Kleine Regel-Aenderungen sind besser als grosse Bauchentscheidungen.',
      'Nach jeder Aenderung echte Faelle beobachten.',
    ],
    sections: [
      {
        title: 'Worum es geht',
        body: 'Korrelation verhindert, dass jede Kleinigkeit ein eigenes Ticket wird. Gleichzeitig darf sie nichts Wichtiges verschlucken.',
      },
      {
        title: 'Sinnvoll anpassen',
        body: 'Arbeite immer mit Wirkungskontrolle.',
        steps: [
          'Regel oder Schwelle identifizieren.',
          'Aenderung klein halten.',
          'Speichern.',
          'Danach neue Tickets und Zusammenfuehrungen beobachten.',
        ],
      },
    ],
    related: ['bedienung/tickets', 'admin/ki-agent'],
  },
  {
    slug: 'admin/audit-compliance',
    title: 'Audit und Compliance',
    summary: 'Hier pruefst du nachvollziehbare Aktivitaeten und Nachweise fuer den Betrieb.',
    audience: 'Admins, Auditoren, Engineers',
    goal: 'Klar sehen, wer was wann gemacht hat.',
    beforeYouStart: [
      'Nicht jeder Eintrag ist automatisch schlimm. Erst Kontext lesen.',
      'Beim Export immer pruefen, wer die Daten braucht.',
      'Audit ersetzt keine Analyse, aber es belegt Handlungen.',
    ],
    sections: [
      {
        title: 'Wofuer diese Seite gut ist',
        body: 'Audit hilft dir bei Rueckfragen, Untersuchungen und Nachweisen. Compliance zeigt Luecken, nicht Zauberkonformitaet.',
      },
      {
        title: 'So arbeitest du damit',
        body: 'Erst suchen, dann bewerten.',
        steps: [
          'Nach Zeitraum, Aktion oder Benutzer filtern.',
          'Relevanten Eintrag oeffnen.',
          'Mit Ticket, Setting oder Event abgleichen.',
          'Nur bei Bedarf exportieren oder weitergeben.',
        ],
      },
    ],
    related: ['bedienung/systemstatus', 'bedienung/nis2'],
  },
  {
    slug: 'bedienung/tickets',
    title: 'Tickets bearbeiten',
    summary: 'Tickets sind dein Hauptarbeitsplatz. Hier wird aus einem Alarm ein bearbeiteter Fall.',
    audience: 'Analysten, Engineers, Admins',
    goal: 'Schnell erkennen, was wichtig ist, und den Fall sauber weiterbearbeiten.',
    beforeYouStart: [
      'Immer erst lesen, dann Status aendern.',
      'Nicht jedes Ticket ist sofort ein echter Incident.',
      'Evidence und Kontext entscheiden, nicht dein Bauchgefuehl.',
    ],
    sections: [
      {
        title: 'Was du in der Ticketliste machst',
        body: 'Die Liste ist zum Sortieren und Priorisieren da, nicht fuer die tiefe Analyse.',
        bullets: [
          'Nach Prioritaet filtern',
          'Nach Status filtern',
          'Eigene oder offene Faelle herausziehen',
        ],
      },
      {
        title: 'Ein Ticket sauber bearbeiten',
        body: 'Diese Reihenfolge ist fuer fast alle Faelle sinnvoll.',
        steps: [
          'Ticket oeffnen.',
          'Titel, Quelle, Prioritaet und Zusammenfassung lesen.',
          'Evidence und Analyse pruefen.',
          'Entscheiden: echt, unklar oder wahrscheinlich falsch positiv.',
          'Status, Notiz oder naechste Aktion setzen.',
        ],
      },
      {
        title: 'Nicht sofort tun',
        body: 'Diese Fehler kosten spaeter Zeit.',
        bullets: [
          'Status auf erledigt setzen, ohne die Belege gelesen zu haben',
          'Nur wegen einer drastischen KI-Zusammenfassung eskalieren',
          'Evidence ignorieren, weil der Titel bedrohlich klingt',
        ],
      },
    ],
    related: ['bedienung/evidence', 'bedienung/hosts', 'bedienung/hunts'],
  },
  {
    slug: 'bedienung/evidence',
    title: 'Evidence Center nutzen',
    summary: 'Hier pruefst du die Beweise hinter Tickets und Hunts.',
    audience: 'Analysten, Engineers, Admins',
    goal: 'Nachvollziehen, warum etwas erkannt wurde.',
    beforeYouStart: [
      'Evidence ist die Grundlage fuer gute Entscheidungen.',
      'Wenn dir ein Ticket komisch vorkommt, schau hier nach.',
      'Nicht nur die Zusammenfassung lesen, sondern die Belege selbst.',
    ],
    sections: [
      {
        title: 'Was Evidence bedeutet',
        body: 'Evidence sind Datenpunkte, Dateien, Events oder Zusammenhaenge, die eine Bewertung begruenden.',
      },
      {
        title: 'So liest du Evidence richtig',
        body: 'Geh von grob nach konkret.',
        steps: [
          'Ticket oder Suchbegriff oeffnen.',
          'Beleg identifizieren.',
          'Pruefen, woher der Beleg kommt.',
          'Auf Zeit, Quelle und Zusammenhang achten.',
          'Erst dann eine Bewertung ableiten.',
        ],
      },
      {
        title: 'Woran du gute Evidence erkennst',
        body: 'Gute Evidence ist nicht nur laut, sondern nachvollziehbar.',
        bullets: [
          'Klare Quelle',
          'Zeitlicher Bezug',
          'Verbindung zum Ticket oder Hunt',
          'Keine reine Behauptung ohne Datenbasis',
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/hunts'],
  },
  {
    slug: 'bedienung/hosts',
    title: 'Hosts verstehen',
    summary: 'Die Host-Seite zeigt dir, welche Systeme betroffen sind und was ueber sie bekannt ist.',
    audience: 'Analysten, Engineers, Admins',
    goal: 'Schnell erkennen, ob ein bestimmter Rechner relevant, gesund oder auffaellig ist.',
    beforeYouStart: [
      'Hosts sind Kontext, nicht automatisch Schuldige.',
      'Leere Listen bedeuten oft ein Integrationsproblem.',
      'Mit Hostdaten erklaerst du Tickets besser.',
    ],
    sections: [
      {
        title: 'Wofuer du die Host-Seite nutzt',
        body: 'Hier schaust du nach dem betroffenen System und nicht nach dem gesamten Fall.',
        bullets: [
          'Agent-Status',
          'Betriebssystem',
          'Inventar oder Schwachstellen',
          'Verbindung zu Tickets und Hunts',
        ],
      },
      {
        title: 'Typischer Arbeitsablauf',
        body: 'Wenn ein Host in einem Ticket auftaucht, geh so vor.',
        steps: [
          'Host in der Liste suchen.',
          'Status und letzte Aktivitaet ansehen.',
          'Offene Schwachstellen oder Besonderheiten pruefen.',
          'Mit Ticket oder Hunt verbinden.',
        ],
      },
    ],
    related: ['bedienung/tickets', 'admin/integrationen'],
  },
  {
    slug: 'bedienung/hunts',
    title: 'Threat Hunts starten',
    summary: 'Hier fuehrst du gezielte Untersuchungen auf Basis eines Verdachts durch.',
    audience: 'Analysten, Engineers',
    goal: 'Einen Verdacht strukturiert pruefen statt planlos zu suchen.',
    beforeYouStart: [
      'Ein Hunt braucht eine Frage oder Hypothese.',
      'Nicht einfach wahllos starten.',
      'Ticket und Host sollten vorher bekannt sein.',
    ],
    sections: [
      {
        title: 'Wann du einen Hunt nutzt',
        body: 'Ein Hunt ist sinnvoll, wenn ein normales Ticket nicht genug Klarheit gibt oder du einen groesseren Zusammenhang pruefen willst.',
      },
      {
        title: 'Einfacher Ablauf',
        body: 'Bleib in einer klaren Reihenfolge.',
        steps: [
          'Host oder Kontext waehlen.',
          'Passende Hunt-Vorlage oder Session starten.',
          'Ergebnisse und Findings lesen.',
          'Evidence pruefen.',
          'Ergebnis ins Ticket zuruecktragen.',
        ],
      },
    ],
    related: ['bedienung/evidence', 'bedienung/tickets'],
  },
  {
    slug: 'bedienung/detections',
    title: 'Detection Library',
    summary: 'Hier siehst du, welche Erkennungsregeln existieren und wofuer sie da sind.',
    audience: 'Analysten, Engineers',
    goal: 'Regeln verstehen, nicht blind anfassen.',
    beforeYouStart: [
      'Die Detection Library ist Uebersicht und Nachvollzug.',
      'Neue Regeln baust du nicht hektisch direkt hier.',
      'Vor Aenderungen immer Wirkung bedenken.',
    ],
    sections: [
      {
        title: 'Wofuer die Seite da ist',
        body: 'Du schaust hier nach, welche Erkennungen aktiv sind, was sie tun und wie sie eingeordnet werden.',
      },
      {
        title: 'So nutzt du die Seite sinnvoll',
        body: 'Erst lesen, dann bewerten.',
        steps: [
          'Regel suchen.',
          'Titel, Kategorie und Zweck lesen.',
          'Mit Ticket oder MITRE-Kontext abgleichen.',
          'Nur bei echtem Bedarf weiter in Use-Case- oder Regelarbeit gehen.',
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/yara'],
  },
  {
    slug: 'bedienung/soc-metriken',
    title: 'SOC-Metriken lesen',
    summary: 'Diese Seite zeigt Kennzahlen zum Betrieb. Sie ist zum Verstehen da, nicht zum Schoenreden.',
    audience: 'Analysten, Leads, Admins',
    goal: 'Sofort erkennen, ob Rueckstau, Belastung oder Qualitaetsprobleme sichtbar werden.',
    beforeYouStart: [
      'Kennzahlen sind Hinweise, keine Wahrheit ohne Kontext.',
      'Steigende Zahlen koennen normal oder kritisch sein.',
      'Immer zusammen mit Tickets und Quelle bewerten.',
    ],
    sections: [
      {
        title: 'Wie du die Zahlen lesen solltest',
        body: 'Schaue nie nur auf eine einzelne Metrik. Interessant ist die Kombination.',
        bullets: [
          'Offene Tickets',
          'Bearbeitungszeiten',
          'Verteilung nach Quellen',
        ],
      },
      {
        title: 'Praktisches Vorgehen',
        body: 'Wenn eine Zahl auffaellig aussieht, geh sofort in die Ursache.',
        steps: [
          'Auffaellige Metrik markieren.',
          'Zugehoerige Tickets oder Quellen oeffnen.',
          'Pruefen, ob ein echter Rueckstau oder nur ein Peak vorliegt.',
          'Massnahme ableiten.',
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/systemstatus'],
  },
  {
    slug: 'bedienung/yara',
    title: 'YARA Engine',
    summary: 'Hier geht es um Signaturen fuer Datei- oder Speicherpruefungen.',
    audience: 'Engineers, erfahrene Analysten',
    goal: 'YARA-Regeln bewusst lesen und einsetzen.',
    beforeYouStart: [
      'Nur oeffnen, wenn du mit Signaturen arbeiten musst.',
      'Aenderungen an Regeln koennen Auswirkungen auf Trefferbilder haben.',
      'Nicht fuer Einsteiger der erste Arbeitsbereich.',
    ],
    sections: [
      {
        title: 'Kurz erklaert',
        body: 'YARA beschreibt Muster. Diese Muster helfen, Dateien oder Speicherbereiche auf bekannte Hinweise zu pruefen.',
      },
      {
        title: 'Sinnvoller Ablauf',
        body: 'Vorsicht statt Aktionismus.',
        steps: [
          'Regel ansehen.',
          'Verstehen, wonach gesucht wird.',
          'Kontext und Zielsystem pruefen.',
          'Treffer nicht blind als Beweis fuer Malware lesen.',
        ],
      },
    ],
    related: ['bedienung/evidence', 'bedienung/detections'],
  },
  {
    slug: 'bedienung/qradar',
    title: 'QRadar Analysis',
    summary: 'Hier arbeitest du mit QRadar-Offenses und uebernimmst sie bei Bedarf in Nexora.',
    audience: 'Analysten, Engineers',
    goal: 'QRadar-Signale geordnet in die Nexora-Bearbeitung ueberfuehren.',
    beforeYouStart: [
      'Die QRadar-Integration muss vorher eingerichtet sein.',
      'Nicht jede Offense braucht sofort ein Ticket.',
      'Erst Kontext lesen, dann uebernehmen.',
    ],
    sections: [
      {
        title: 'Einfacher Arbeitsablauf',
        body: 'So bleibt der Wechsel zwischen QRadar und Nexora sauber.',
        steps: [
          'Offense ansehen.',
          'Bedeutung und Dringlichkeit pruefen.',
          'Nur relevante Offenses in ein Ticket ueberfuehren.',
          'Danach in Nexora normal weiterarbeiten.',
        ],
      },
    ],
    related: ['admin/integrationen', 'bedienung/tickets'],
  },
  {
    slug: 'bedienung/systemstatus',
    title: 'Systemstatus lesen',
    summary: 'Diese Seite ist dein erster Blick bei Betriebsproblemen.',
    audience: 'Analysten, Engineers, Admins',
    goal: 'Schnell unterscheiden: Datenproblem, Integrationsproblem oder echter Dienstausfall.',
    beforeYouStart: [
      'Wenn etwas fehlt oder komisch wirkt, zuerst hier schauen.',
      'Systemstatus ist Diagnose, nicht Reparatur.',
      'Erst Ursache eingrenzen, dann handeln.',
    ],
    sections: [
      {
        title: 'Was du hier suchst',
        body: 'Nicht jede Stoerung ist ein kompletter Ausfall. Diese Seite hilft dir beim Eingrenzen.',
        bullets: [
          'API erreichbar?',
          'Datenbank gesund?',
          'Integrationen melden sich?',
          'Collector oder Web-Komponenten auffaellig?',
        ],
      },
      {
        title: 'Wenn etwas rot oder ungewoehnlich aussieht',
        body: 'Gehe ruhig und strukturiert vor.',
        steps: [
          'Komponente identifizieren.',
          'Pruefen, welche Funktion dadurch betroffen ist.',
          'Mit Tickets, Collectors oder Services abgleichen.',
          'Erst dann den passenden Admin-Schritt waehlen.',
        ],
      },
    ],
    related: ['admin/services', 'admin/integrationen'],
  },
  {
    slug: 'bedienung/deployment-center',
    title: 'Deployment Center',
    summary: 'Diese Seite ist für kontrollierte Rollouts und gesteuerte Reaktionen gedacht.',
    audience: 'Admins, Engineers',
    goal: 'Schreibende Aktionen bewusst und nachvollziehbar ausführen.',
    beforeYouStart: [
      'Nur nutzen, wenn du wirklich eine Rollout- oder Reaktionsaufgabe hast.',
      'Nicht fuer normale Ticket-Triage.',
      'Vor jeder Aktion genau lesen, was ausgelöst wird.',
    ],
    sections: [
      {
        title: 'Wofür die Seite da ist',
        body: 'Deployment bedeutet hier nicht nur Software verteilen, sondern kontrollierte technische Aktionen auf Nodes oder Systemteilen.',
      },
      {
        title: 'Sichere Nutzung',
        body: 'Bleibe bei einem konservativen Ablauf.',
        steps: [
          'Ziel wählen.',
          'Vorschau und Bedingungen lesen.',
          'Prüfen, ob Freigabe oder Gate nötig ist.',
          'Aktion bewusst starten.',
          'Rückmeldung und Status kontrollieren.',
        ],
      },
    ],
    related: ['admin/provisioning', 'bedienung/systemstatus'],
  },
  {
    slug: 'bedienung/nis2',
    title: 'NIS2 Readiness',
    summary: 'Diese Seite zeigt euren Reifegrad und vorhandene Nachweise. Sie behauptet keine automatische Konformitaet.',
    audience: 'Admins, Management-nahe Rollen, Auditoren',
    goal: 'Luecken und Nachweise sichtbar machen.',
    beforeYouStart: [
      'NIS2-Readiness ist eine Orientierung, kein Freifahrtschein.',
      'Fehlende Nachweise sind Arbeitsauftraege.',
      'Diese Seite ist fuer Struktur da, nicht fuer Marketing.',
    ],
    sections: [
      {
        title: 'So liest du die Seite richtig',
        body: 'Achte auf fehlende Belege, offene Punkte und Management-relevante Luecken.',
      },
      {
        title: 'Einfaches Vorgehen',
        body: 'Wenn du die Seite pflegst oder bewertest, arbeite systematisch.',
        steps: [
          'Control oder Bereich auswaehlen.',
          'Vorhandene Evidence pruefen.',
          'Luecken markieren.',
          'Naechste Massnahme festlegen.',
        ],
      },
    ],
    related: ['admin/audit-compliance'],
  },
];

export const WIKI_MANUAL_BY_SLUG = Object.fromEntries(
  WIKI_MANUAL_PAGES.map((page) => [page.slug, page]),
) as Record<string, WikiManualPage>;

export function getWikiManualPage(slug?: string): WikiManualPage | undefined {
  if (!slug) return undefined;
  return WIKI_MANUAL_BY_SLUG[slug];
}

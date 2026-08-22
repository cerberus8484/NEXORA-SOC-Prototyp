'use strict';

const { randomUUID } = require('crypto');

// Erlaubte Enums — zentral definiert, von Schema + Modell genutzt
const PRIORITIES = ['critical', 'high', 'medium', 'low', 'info'];
// State = Lifecycle (eigenes Feld), Status = Workflow innerhalb OPEN.
const STATES        = ['OPEN', 'CLOSED'];
const STATUSES      = ['assigned', 'in_progress', 'on_hold', 'awaiting_customer'];
// 'False Positive' ist ein Schliessgrund, kein Status (siehe Migration 004).
const CLOSE_REASONS = ['', 'resolved', 'false_positive', 'duplicate', 'benign', 'other'];
// Ticket-Quellen. MUSS alle Werte enthalten, die Live-Adapter tatsächlich vergeben —
// sonst sind reale Tickets weder per HTTP anlegbar noch filterbar (listTicketsSchema
// prüft den Filter-Param gegen diese Enum). crowdsec/email/dataplane kommen aus
// CrowdsecProcessor/EmailProcessor/DataplaneIncidentAdapter.
const SOURCES    = ['manual', 'qradar', 'splunk', 'soar', 'servicenow', 'otrs', 'webhook', 'wazuh', 'threat_hunt', 'crowdsec', 'email', 'dataplane'];

class Ticket {
  constructor({
    id         = randomUUID(),
    ticketNr   = '',
    offenseId  = '',
    title      = '',
    category   = '',
    useCase    = '',
    priority   = 'medium',
    state      = 'OPEN',
    status     = 'assigned',
    closeReason = '',
    analyst    = '',
    customer   = '',
    source     = 'manual',
    alertCount = 1,
    kind       = 'alert',
    parentId   = '',
    datetime   = new Date().toISOString(),
    // Identity
    user       = '',
    email      = '',
    dept       = '',
    manager    = '',
    userType   = '',
    accStatus  = '',
    // Network
    srcIp      = '',
    srcFqdn    = '',
    dstIp      = '',
    dstFqdn    = '',
    extIp      = '',
    extFqdn    = '',
    sensorIp   = '',
    attackerIp = '',
    mac        = '',
    hostname   = '',
    network    = '',
    port       = '',
    protocol   = '',
    vpn        = '',
    bytesSent  = '',
    bytesRecv  = '',
    // Flow-Statistik (App-Map): Pakete, Firewall-Action, Zeitfenster, Event-Zahl.
    // Additiv — v. a. für Dataplane-/Honeypot-Tickets (Conntrack-Flow-Zähler).
    pktsSent   = '',
    pktsRecv   = '',
    firewallAction = '', // denied/permitted-Quelle (z. B. 'block'/'pass')
    firstSeen  = '',     // Beginn des beobachteten Flow-Fensters (ISO)
    lastSeen   = '',     // Ende des beobachteten Flow-Fensters (ISO)
    eventCount = '',     // Anzahl gefuster/beobachteter Events (speist FE totalEvents)
    postNatSrc = '',
    postNatSrcFqdn = '',
    postNatDst = '',
    postNatDstFqdn = '',
    // System
    os             = '',
    assetTag       = '',
    criticality    = '',
    process        = '',
    commandLine    = '',
    hash           = '',
    mitre          = '',
    // Analysis
    description = '',
    iocs        = '',
    logs        = '',
    actions     = '',
    recommendation = '',
    notes       = '',
    decision    = '',   // Analyst-Decision: benign|suspicious|incident|fp
    confidence  = null, // 0-100
    // Payload-Artefakte (eingebettet — Editor-Parität zum Ursprungs-Tool):
    // [{ id, type, raw, fields:{...}, createdAt }]
    payloads    = [],
    // Threat-Intel-Einträge (mehrere pro Ticket — Editor-Parität):
    // [{ id, category, actor, malware, confidence }]
    tiEntries   = [],
    // Analyst-Workflow-Zustand: Checkliste + Playbook-Status (persistiert als JSONB)
    // { checklist: [{id, label, done}], playbook: {id, step, status} | {} }
    analystState = {},
    // Relations (IDs only — keine eingebetteten Objekte)
    payloadIds  = [],
    evidenceIds = [],
    externalLinkIds = [],
    // Timestamps
    createdAt   = new Date().toISOString(),
    updatedAt   = new Date().toISOString(),
    // Echter Close-Zeitpunkt (Übergang nach state=CLOSED); null solange offen.
    // Basis für die MTTR — NICHT updatedAt, das bei jedem Edit springt (Audit #1).
    closedAt    = null,
  } = {}) {
    this.id          = id;
    this.ticketNr    = ticketNr;
    this.offenseId   = offenseId;
    this.title       = title;
    this.category    = category;
    this.useCase     = useCase;
    this.priority    = priority;
    this.state       = state;
    this.status      = status;
    this.closeReason = closeReason;
    this.analyst     = analyst;
    this.customer    = customer;
    this.source      = source;
    this.alertCount  = alertCount;
    this.kind        = kind;
    this.parentId    = parentId;
    this.datetime    = datetime;
    this.user        = user;
    this.email       = email;
    this.dept        = dept;
    this.manager     = manager;
    this.userType    = userType;
    this.accStatus   = accStatus;
    this.srcIp       = srcIp;
    this.srcFqdn     = srcFqdn;
    this.dstIp       = dstIp;
    this.dstFqdn     = dstFqdn;
    this.extIp       = extIp;
    this.extFqdn     = extFqdn;
    this.sensorIp    = sensorIp;
    this.attackerIp  = attackerIp;
    this.mac         = mac;
    this.hostname    = hostname;
    this.network     = network;
    this.port        = port;
    this.protocol    = protocol;
    this.vpn         = vpn;
    this.bytesSent   = bytesSent;
    this.bytesRecv   = bytesRecv;
    this.pktsSent    = pktsSent;
    this.pktsRecv    = pktsRecv;
    this.firewallAction = firewallAction;
    this.firstSeen   = firstSeen;
    this.lastSeen    = lastSeen;
    this.eventCount  = eventCount;
    this.postNatSrc  = postNatSrc;
    this.postNatSrcFqdn = postNatSrcFqdn;
    this.postNatDst  = postNatDst;
    this.postNatDstFqdn = postNatDstFqdn;
    this.os          = os;
    this.assetTag    = assetTag;
    this.criticality = criticality;
    this.process     = process;
    this.commandLine = commandLine;
    this.hash        = hash;
    this.mitre       = mitre;
    this.description = description;
    this.iocs        = iocs;
    this.logs        = logs;
    this.actions     = actions;
    this.recommendation = recommendation;
    this.notes       = notes;
    this.decision    = decision;
    this.confidence  = confidence;
    this.analystState = analystState;
    this.payloads    = payloads;
    this.tiEntries   = tiEntries;
    this.payloadIds  = payloadIds;
    this.evidenceIds = evidenceIds;
    this.externalLinkIds = externalLinkIds;
    this.createdAt   = createdAt;
    this.updatedAt   = updatedAt;
    // Reiner Daten-Träger: closedAt wird durchgereicht (DB-Roundtrip liefert null
    // für nicht-backfillten Altbestand → bleibt null, zählt NICHT in die MTTR).
    // Die Transitions-Logik (OPEN→CLOSED setzt, CLOSED→OPEN löscht) liegt bewusst
    // in create()/update(), nicht hier (CQS). Ein OPEN-Ticket trägt nie closedAt.
    this.closedAt    = state === 'CLOSED' ? (closedAt || null) : null;
  }

  // Factory-Methode — Ticket aus Rohdaten erstellen
  static create(data) {
    const now = new Date().toISOString();
    return new Ticket({
      ...data,
      id:        randomUUID(),
      createdAt: now,
      updatedAt: now,
      // OPEN → null, CLOSED → Erstell-Zeitpunkt (direkt geschlossen erstellt).
      closedAt:  (data && data.state === 'CLOSED') ? now : null,
    });
  }

  // Ticket aktualisieren — gibt eine neue Instanz zurück (immutable)
  update(data) {
    const allowed = [
      'title','category','useCase','priority','state','status','closeReason','analyst','customer','alertCount','kind','parentId',
      'user','email','dept','manager','userType','accStatus',
      'srcIp','srcFqdn','dstIp','dstFqdn','extIp','extFqdn','sensorIp','attackerIp',
      'mac','hostname','network','port','protocol','vpn',
      'bytesSent','bytesRecv','pktsSent','pktsRecv','firewallAction','firstSeen','lastSeen','eventCount',
      'postNatSrc','postNatSrcFqdn',
      'postNatDst','postNatDstFqdn',
      'os','assetTag','criticality','process','hash','mitre',
      'description','iocs','logs','actions','recommendation','notes','decision','confidence',
      'payloads','tiEntries','analystState',
    ];
    const prevState = this.state;
    allowed.forEach(key => {
      if (data[key] !== undefined) this[key] = data[key];
    });
    // closedAt an der Lifecycle-Transition ausrichten (Audit #1):
    //   OPEN → CLOSED  : Close-Zeitpunkt festhalten (now)
    //   CLOSED → OPEN  : Re-Open → closedAt löschen
    //   sonst (kein Wechsel): closedAt bleibt unangetastet — spätere Edits an einem
    //   geschlossenen Ticket dürfen die MTTR nicht verschieben.
    if (prevState !== 'CLOSED' && this.state === 'CLOSED') {
      this.closedAt = new Date().toISOString();
    } else if (prevState === 'CLOSED' && this.state === 'OPEN') {
      this.closedAt = null;
    }
    this.updatedAt = new Date().toISOString();
    return this;
  }

  // Für API-Responses — keine internen Details exponieren
  toJSON() {
    return { ...this };
  }
}

module.exports = { Ticket, PRIORITIES, STATES, STATUSES, CLOSE_REASONS, SOURCES };

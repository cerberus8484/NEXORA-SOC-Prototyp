'use strict';

const Joi = require('joi');
const { PRIORITIES, STATES, STATUSES, CLOSE_REASONS, SOURCES } = require('../Ticket');
const { PAYLOAD_TYPES } = require('../Payload');

const STR   = Joi.string().max(5000).allow('').default('');
const STR20K = Joi.string().max(20000).allow('').default(''); // logs: vollständiges Roh-Event (Windows-Events groß)
const STR200 = Joi.string().max(200).allow('').default('');
const STR100 = Joi.string().max(100).allow('').default('');
const IP    = Joi.string().ip({ version: ['ipv4','ipv6'], cidr: 'optional' }).allow('').default('');

// Schema für POST /tickets — alle Pflichtfelder minimal
const createTicketSchema = Joi.object({
  ticketNr   : STR100,
  offenseId  : STR100,
  title      : Joi.string().max(200).required(),
  category   : STR200,
  useCase    : STR200,
  priority   : Joi.string().valid(...PRIORITIES).default('medium'),
  state      : Joi.string().valid(...STATES).default('OPEN'),
  status     : Joi.string().valid(...STATUSES).default('assigned'),
  closeReason: Joi.string().valid(...CLOSE_REASONS).default(''),
  analyst    : STR100,
  customer   : STR200,
  alertCount : Joi.number().integer().min(1).default(1),
  kind       : Joi.string().valid('alert', 'case').default('alert'),
  parentId   : Joi.string().allow('').default(''),
  source     : Joi.string().valid(...SOURCES).default('manual'),
  datetime   : Joi.string().isoDate().allow('').default(''),
  // Identity
  user       : STR100,
  email      : Joi.string().email().allow('').default(''),
  dept       : STR100,
  manager    : STR100,
  userType   : STR100,
  accStatus  : STR100,
  // Network
  srcIp      : IP,
  srcFqdn    : STR200,
  dstIp      : IP,
  dstFqdn    : STR200,
  extIp      : IP,
  extFqdn    : STR200,
  sensorIp   : IP,
  attackerIp : IP,
  mac        : Joi.string().max(20).allow('').default(''),
  hostname   : STR200,
  network    : STR200,
  port       : STR100,
  protocol   : STR100,
  vpn        : STR200,
  bytesSent  : STR100,
  bytesRecv  : STR100,
  // Flow-Statistik (App-Map) — additiv, bounded. Untrusted (Conntrack-Zähler): auf
  // kurze Strings begrenzt; Zeitfenster als ISO-Datum validiert (kein freier Text).
  pktsSent   : STR100,
  pktsRecv   : STR100,
  firewallAction: STR100,
  firstSeen  : Joi.string().isoDate().allow('').default(''),
  lastSeen   : Joi.string().isoDate().allow('').default(''),
  eventCount : STR100,
  postNatSrc : IP,
  postNatSrcFqdn: STR200,
  postNatDst : IP,
  postNatDstFqdn: STR200,
  // System
  os         : STR200,
  assetTag   : STR100,
  criticality: STR100,
  process    : STR200,
  commandLine: STR20K,
  hash       : Joi.string().max(256).allow('').default(''),
  mitre      : STR200,
  // Analysis — längere Texte erlaubt
  description   : STR,
  iocs          : STR,
  logs          : STR20K,
  actions       : STR,
  recommendation: STR,
  notes         : STR,
  decision      : Joi.string().valid('', 'benign', 'suspicious', 'incident', 'fp').default(''),
  confidence    : Joi.number().integer().min(0).max(100).allow(null).default(null),
  // Payload-Artefakte (Editor-Parität zum Ursprungs-Tool) — eingebettet am Ticket
  payloads      : Joi.array().items(Joi.object({
    id        : STR100,
    type      : Joi.string().valid('', ...PAYLOAD_TYPES).default(''),
    raw       : Joi.string().max(20000).allow('').default(''),
    fields    : Joi.object().pattern(Joi.string().max(50), Joi.string().max(20000).allow('')).default({}),
    createdAt : STR100,
  }).options({ stripUnknown: true })).max(50).default([]),

  // Threat-Intel-Einträge (mehrere pro Ticket — Editor-Parität)
  tiEntries     : Joi.array().items(Joi.object({
    id        : STR100,
    category  : STR100,
    actor     : STR200,
    malware   : STR200,
    confidence: STR100,
  }).options({ stripUnknown: true })).max(50).default([]),

  // Analyst-Workflow-Zustand: Checkliste + Playbook (persistent via JSONB)
  analystState  : Joi.object({
    checklist : Joi.array().items(Joi.object({
      id    : STR100,
      label : Joi.string().max(500).allow('').default(''),
      done  : Joi.boolean().default(false),
    }).options({ stripUnknown: true })).max(100).default([]),
    playbook  : Joi.alternatives().try(
      Joi.object({
        id    : STR100,
        step  : Joi.number().integer().min(0).default(0),
        status: Joi.string().valid('', 'in_progress', 'done', 'skipped').default(''),
      }).options({ stripUnknown: true }),
      Joi.object().max(0), // leeres Objekt {}
    ).default({}),
  }).options({ stripUnknown: true }).default({}),
}).options({ abortEarly: false, stripUnknown: true });

// Schema für PUT /tickets/:id — alle Felder optional
const updateTicketSchema = createTicketSchema.fork(
  ['title'],
  field => field.optional()
);

// Schema für GET /tickets — Query-Parameter
const listTicketsSchema = Joi.object({
  state    : Joi.string().valid(...STATES),
  status   : Joi.string().valid(...STATUSES),
  priority : Joi.string().valid(...PRIORITIES),
  source   : Joi.string().valid(...SOURCES),
  analyst  : Joi.string().max(100),
  customer : Joi.string().max(200),
  search   : Joi.string().max(200),
  limit    : Joi.number().integer().min(1).max(500).default(50),
  offset   : Joi.number().integer().min(0).default(0),
  sort     : Joi.string().valid('createdAt','updatedAt','priority','status','state').default('createdAt'),
  order    : Joi.string().valid('asc','desc').default('desc'),
}).options({ abortEarly: false, stripUnknown: true });

// Schema für GET /tickets/ids — „alle gefilterten auswählen": nur IDs, gleiche Filter wie
// die Liste, aber höheres limit (max 5000 == SELECT_ALL_LIMIT im Frontend). Bewusst gedeckelt
// (keine unbounded Query). Erbt die Filter/Sort-Regeln von listTicketsSchema.
const idTicketsSchema = listTicketsSchema.keys({
  limit: Joi.number().integer().min(1).max(5000).default(5000),
});

// Schema für POST /tickets/:id/import — Preview-only, kein Persistieren
const importRawSchema = Joi.object({
  raw       : Joi.string().min(1).max(20000).required(),
  sourceType: Joi.string().max(200).allow('').default('manual'),
}).options({ abortEarly: false, stripUnknown: true });

// Schema für POST /tickets/:id/export — externes Zielsystem (Outbound)
const EXPORT_SYSTEMS = ['servicenow', 'otrs'];
const exportTicketSchema = Joi.object({
  system: Joi.string().valid(...EXPORT_SYSTEMS).required(),
}).options({ abortEarly: false, stripUnknown: true });

// Schema für POST /tickets/bulk-delete — admin-Sammel-Löschung.
// Bounded (max 100) → keine unbounded Operation; UUID-Validierung schützt zugleich
// den Postgres ANY($1::uuid[])-Cast vor Müll-Eingaben.
const MAX_BULK_DELETE = 100;
const bulkDeleteTicketsSchema = Joi.object({
  ids: Joi.array().items(Joi.string().uuid()).min(1).max(MAX_BULK_DELETE).required(),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = {
  createTicketSchema, updateTicketSchema, listTicketsSchema, idTicketsSchema, importRawSchema,
  exportTicketSchema, EXPORT_SYSTEMS, bulkDeleteTicketsSchema, MAX_BULK_DELETE,
};

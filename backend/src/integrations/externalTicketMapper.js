'use strict';

/**
 * externalTicketMapper — gemeinsame Mapping-Logik für alle Outbound-Adapter.
 *
 * ServiceNow und OTRS haben ähnliche Konzepte aber unterschiedliche Werte.
 * Diese Basis-Funktionen werden von spezifischen Mappern wiederverwendet.
 */

// Interne Priority → Impact/Urgency-ähnliche Werte
// Werden von konkreten Adaptern überschrieben wenn nötig
const PRIORITY_LABELS = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
  info:     'Informational',
};

const STATUS_LABELS = {
  open:     'New',
  progress: 'In Progress',
  closed:   'Resolved',
  fp:       'Closed (False Positive)',
};

function mapPriorityLabel(priority)  { return PRIORITY_LABELS[priority]  || 'Medium'; }
function mapStatusLabel(status)      { return STATUS_LABELS[status]       || 'New'; }

/**
 * Basis-Felder die alle externen Ticketsysteme brauchen.
 * Spezifische Mapper ergänzen systemspezifische Felder.
 */
function mapBaseFields(ticket) {
  return {
    // Identifikation
    internalId:    ticket.id,
    internalRef:   ticket.ticketNr || ticket.offenseId || ticket.id,

    // Kern-Felder
    title:         ticket.title,
    description:   buildDescription(ticket),
    priority:      mapPriorityLabel(ticket.priority),
    status:        mapStatusLabel(ticket.status),
    analyst:       ticket.analyst || '',
    category:      ticket.category || '',

    // Zeitstempel
    createdAt:     ticket.createdAt,
    updatedAt:     ticket.updatedAt,
    occuredAt:     ticket.datetime || '',

    // Netzwerk (als lesbarer Text)
    affectedHost:  [ticket.hostname, ticket.srcIp].filter(Boolean).join(' / '),
    sourceIp:      ticket.srcIp || '',
    destIp:        ticket.dstIp || '',

    // MITRE
    mitre:         ticket.mitre || '',
  };
}

/**
 * Beschreibung aus Analyse-Feldern aufbauen.
 * Jeder Abschnitt ist separat benannt und optional.
 */
function buildDescription(ticket) {
  return [
    ticket.description,
    formatSection('IOCs',          ticket.iocs),
    formatSection('Log-Quellen',   ticket.logs),
    formatSection('Maßnahmen',     ticket.actions),
    formatSection('Empfehlung',    ticket.recommendation),
  ].filter(Boolean).join('\n\n').trim().slice(0, 5000);
}

/** Einzelner benannter Abschnitt — null wenn Inhalt leer */
function formatSection(title, content) {
  return content?.trim() ? `--- ${title} ---\n${content.trim()}` : null;
}

module.exports = { mapBaseFields, buildDescription, formatSection, mapPriorityLabel, mapStatusLabel, PRIORITY_LABELS, STATUS_LABELS };

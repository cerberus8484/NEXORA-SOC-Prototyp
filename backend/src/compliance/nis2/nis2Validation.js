'use strict';

// Gemeinsame Validierungs-Helfer für das NIS2-Modul (P_NIS2_1).
// Fokus: keine HTML-Injection, keine Steuerzeichen, und bei Evidence-Refs keine
// Secret-artigen URLs (kein user:password@, nur http/https, keine Token-Query-Keys).

const { ValidationError } = require('../../errors/AppError');

// Validierungsfehler als AppError (ValidationError → HTTP 400 über den zentralen
// errorHandler). Ein plain Error würde sonst als 500 behandelt.
function err(message) { return new ValidationError(message); }

function hasForbiddenControlChar(value) {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c === 127 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) return true;
  }
  return false;
}

function assertSafeText(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw err(`${field} muss Text sein`);
  if (value.length > max) throw err(`${field} darf maximal ${max} Zeichen haben`);
  if (/[<>]/.test(value)) throw err(`${field} enthält unerlaubte Zeichen (< oder >)`);
  if (hasForbiddenControlChar(value)) throw err(`${field} enthält unerlaubte Steuerzeichen`);
  return value;
}

function assertIsoDateOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw err(`${field} ist kein gültiges Datum`);
  return d.toISOString();
}

// Secret-verdächtige Query-Keys — eine Evidence-URL darf solche NICHT tragen
// (sonst landen Tokens/Keys im Klartext im Modell/Audit/UI).
const SECRET_QUERY_KEY = /(token|secret|password|bearer|authorization|api[_-]?key|key)/i;

// Validiert eine Evidence-Referenz. Plain-Refs (z. B. "INC000460", UUIDs) sind
// erlaubt. Sieht die Ref wie eine URL aus (enthält "://"), gelten harte Regeln:
//   - nur http/https
//   - kein user:password@ (keine eingebetteten Credentials)
//   - keine Secret-artigen Query-Keys
// Scheme = Buchstabe + mind. ein weiteres Scheme-Zeichen + ":" (so wird ein
// Windows-Laufwerk "C:\" NICHT als Scheme erkannt, aber "javascript:" schon).
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

// Wirft, sobald ein Key (Query oder Fragment) Secret-artig aussieht.
function assertNoSecretKeys(keyIterable, field) {
  for (const k of keyIterable) {
    if (SECRET_QUERY_KEY.test(k)) {
      throw err(`${field} enthält einen Secret-artigen Parameter ('${k}') — nicht erlaubt`);
    }
  }
}

function assertSafeEvidenceRef(value, field, max) {
  const ref = assertSafeText(value, field, max);
  if (!ref || ref.trim() === '') throw err(`${field} ist erforderlich`);
  if (!HAS_SCHEME.test(ref)) return ref; // Plain-Ref (Ticket-ID, UUID, Pfad …)

  // Hat ein Scheme → es MUSS eine http/https-URL sein (lehnt javascript:/data:/ftp:/file: ab).
  if (!/^https?:\/\//i.test(ref)) throw err(`${field} erlaubt nur http/https-URLs`);
  // Steuerzeichen in URLs ablehnen — WHATWG-URL würde Tab/Newline still strippen,
  // sodass der gespeicherte Wert von der normalisierten URL abwiche.
  if (/[\t\n\r]/.test(ref)) throw err(`${field} darf keine Steuerzeichen in einer URL enthalten`);
  let url;
  try { url = new URL(ref); } catch { throw err(`${field} ist keine gültige URL`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw err(`${field} erlaubt nur http/https-URLs`);
  }
  if (url.username || url.password) {
    throw err(`${field} darf keine eingebetteten Zugangsdaten (user:password@) enthalten`);
  }
  // Secret-artige Keys NICHT nur in der Query, sondern AUCH im Fragment prüfen
  // (OAuth-Implicit-Flows liefern Tokens hinter '#', das searchParams nicht sieht).
  assertNoSecretKeys(url.searchParams.keys(), field);
  if (url.hash) assertNoSecretKeys(new URLSearchParams(url.hash.slice(1)).keys(), field);
  return ref;
}

module.exports = { err, hasForbiddenControlChar, assertSafeText, assertIsoDateOrNull, assertSafeEvidenceRef, SECRET_QUERY_KEY };

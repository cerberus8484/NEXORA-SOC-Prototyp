'use strict';

// Joi-Body-Schemas für die Deploy-Routen (Phase 6). Grundform-Validierung
// (typisiert, keine freien Strings/JSON-Blobs als Body). Die fachliche
// Params-Validierung gegen module.paramSchema macht deployParamValidation;
// die Allowlist-Prüfung (Modul/Connector-Typ) macht die Domain/der Service.

const Joi = require('joi');

const OPTS = { abortEarly: false, stripUnknown: true };

// Ressourcen-Grenzen (defensiv; großzügige Obergrenzen, harte Untergrenzen).
const resourcesSchema = Joi.object({
  cpu:    Joi.number().integer().min(1).max(64).required(),
  ramMB:  Joi.number().integer().min(512).max(262144).required(),
  diskGB: Joi.number().integer().min(1).max(4096).required(),
});

// Einen Connector anlegen. Secrets (apiToken bzw. privateKey/passphrase) werden im
// Service verschlüsselt (secretsCrypto) — sie dürfen NIE geloggt/zurückgegeben werden.
// Zwei Typen: 'proxmox' (Hypervisor, VM-Klon) und 'ssh' (agent-install / Linux-Client).
const createConnectorSchema = Joi.object({
  type:       Joi.string().valid('proxmox', 'ssh').required(),
  name:       Joi.string().max(200).required(),
  host:       Joi.string().max(253).required(),

  // proxmox-only
  apiToken:   Joi.string().max(500),
  targetNode: Joi.string().max(200),
  storage:    Joi.string().max(200).allow('', null),
  bridge:     Joi.string().max(200).allow('', null),
  verifyTls:  Joi.boolean().default(true),

  // ssh-only — privateKey (write-only, wird verschlüsselt), hostKeyPin = SHA-256-Hex.
  // sshUser deckt POSIX (root/deploy) UND Windows (Administrator) ab, injektionssicher.
  sshUser:    Joi.string().pattern(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/),
  sshPort:    Joi.number().integer().min(1).max(65535),
  privateKey: Joi.string().max(20000),
  passphrase: Joi.string().max(500).allow('', null),
  hostKeyPin: Joi.string().pattern(/^[a-fA-F0-9]{64}$/),
})
  // proxmox: host NUR IPv4 (kein DNS-Rebinding der SSRF-Allowlist), apiToken+targetNode Pflicht.
  // ssh-Felder verboten → kein versehentliches Mitschicken eines Klartext-privateKey.
  .when(Joi.object({ type: Joi.valid('proxmox').required() }).unknown(), {
    then: Joi.object({
      host:       Joi.string().ip({ version: ['ipv4'], cidr: 'forbidden' }).required(),
      apiToken:   Joi.required(),
      targetNode: Joi.required(),
      sshUser:    Joi.forbidden(),
      sshPort:    Joi.forbidden(),
      privateKey: Joi.forbidden(),
      passphrase: Joi.forbidden(),
      hostKeyPin: Joi.forbidden(),
    }),
  })
  // ssh: host = IP/DNS (injektionssicher), privateKey+hostKeyPin Pflicht.
  // proxmox-Felder verboten → kein versehentliches Mitschicken eines Klartext-apiToken.
  .when(Joi.object({ type: Joi.valid('ssh').required() }).unknown(), {
    then: Joi.object({
      host:       Joi.string().pattern(/^[a-zA-Z0-9.-]{1,253}$/).required(),
      privateKey: Joi.required(),
      hostKeyPin: Joi.required(),
      apiToken:   Joi.forbidden(),
      targetNode: Joi.forbidden(),
      storage:    Joi.forbidden(),
      bridge:     Joi.forbidden(),
    }),
  })
  .options(OPTS);

// Eine Deploy-Spec anlegen. params ist ein Objekt (kein freier String); der
// Inhalt wird separat gegen module.paramSchema validiert.
const createSpecSchema = Joi.object({
  moduleId:    Joi.string().max(100).required(),
  connectorId: Joi.string().max(100).required(),
  targetNode:  Joi.string().max(200).required(),
  storage:     Joi.string().max(200).required(),
  bridge:      Joi.string().max(200).required(),
  resources:   resourcesSchema.optional(),
  params:      Joi.object().required(),
}).options(OPTS);

// Approve/Apply tragen schlanke Bodies — Approver kommt aus der Auth, der
// Reauth-Token aus dem X-Reauth-Token-Header (nicht aus dem Body).
const approveSchema = Joi.object({
  note: Joi.string().max(2000).allow('').optional(),
}).options(OPTS);

const applySchema = Joi.object({}).options(OPTS);

module.exports = { createConnectorSchema, createSpecSchema, approveSchema, applySchema, resourcesSchema };

'use strict';

const { randomUUID } = require('crypto');

const MAX_VALUE = 200;

/**
 * UseCase — Eintrag der geteilten Use-Case-Bibliothek (z.B. "UC-042 – Lateral Movement
 * Detection"). Im Ursprungs-Tool eine pro-Browser-Stringliste (localStorage
 * `soc_usecases`); hier Backend-persistent und über alle Analysten geteilt.
 */
class UseCase {
  constructor({ id, value, author = '', createdAt, updatedAt } = {}) {
    this.id        = id || randomUUID();
    this.value     = String(value ?? '').trim().slice(0, MAX_VALUE);
    this.author    = String(author ?? '').trim();
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
  }

  isValid() {
    return Boolean(this.value);
  }

  toJSON() {
    return {
      id: this.id, value: this.value, author: this.author,
      createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }
}

module.exports = { UseCase, MAX_VALUE };

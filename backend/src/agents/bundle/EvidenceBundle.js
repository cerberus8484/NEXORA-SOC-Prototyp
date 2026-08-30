'use strict';

/**
 * EvidenceBundle — P18.1 AI Evidence Bundle
 *
 * Domain-Objekt. Unveränderlich nach Erstellung.
 * Schema-Version ermöglicht spätere Erweiterungen (Asset, Identity, Baseline)
 * ohne den Prompt jedes Mal neu zu bauen.
 */
class EvidenceBundle {
  static SCHEMA_VERSION = 'ai-evidence-bundle/v1';

  constructor({
    ticket,
    wazuhAlert,
    evidence = [],
    derivedObservations = [],
    missingData = [],
  }) {
    this.schemaVersion       = EvidenceBundle.SCHEMA_VERSION;
    this.ticket              = Object.freeze(ticket || {});
    this.wazuhAlert          = Object.freeze(wazuhAlert || { available: false });
    this.evidence            = Object.freeze([...evidence]);
    this.derivedObservations = Object.freeze([...derivedObservations]);
    this.missingData         = Object.freeze([...missingData]);
    Object.freeze(this);
  }

  /** Gibt an ob ein nutzbarer Wazuh-Alert im Bundle ist. */
  get hasAlert() { return this.wazuhAlert.available === true; }

  /** Gibt an ob Evidence-Einträge vorhanden sind. */
  get hasEvidence() { return this.evidence.length > 0; }

  toJSON() {
    return {
      schemaVersion:       this.schemaVersion,
      ticket:              this.ticket,
      wazuhAlert:          this.wazuhAlert,
      evidence:            this.evidence,
      derivedObservations: this.derivedObservations,
      missingData:         this.missingData,
    };
  }
}

module.exports = { EvidenceBundle };

'use strict';

const { HttpClient } = require('./HttpClient');

/**
 * InMemoryHttpClient — für Tests ohne echte Verbindung.
 *
 * Konfigurierbare Antworten per URL-Pattern oder Queue.
 * Alle gesendeten Requests werden aufgezeichnet → assertierbar.
 */
class InMemoryHttpClient extends HttpClient {
  constructor() {
    super();
    this._responses = []; // Queue: [{status, data}]
    this._requests  = []; // Aufgezeichnete Requests
    this._urlMap    = new Map(); // URL-Pattern → Response
  }

  // Nächste Antwort in die Queue stellen
  queueResponse(status, data) {
    this._responses.push({ status, data });
    return this;
  }

  // Antwort für bestimmtes URL-Pattern konfigurieren
  mockUrl(urlPattern, status, data) {
    this._urlMap.set(urlPattern, { status, data });
    return this;
  }

  async request(url, options = {}) {
    this._requests.push({ url, ...options, timestamp: new Date().toISOString() });

    // URL-Pattern zuerst prüfen
    for (const [pattern, response] of this._urlMap.entries()) {
      if (url.includes(pattern)) {
        if (response.status >= 400) {
          const err  = new Error(`HTTP ${response.status}`);
          err.status = response.status;
          err.response = response.data;
          throw err;
        }
        return response;
      }
    }

    // Queue-Response
    if (this._responses.length > 0) {
      const response = this._responses.shift();
      if (response.status >= 400) {
        const err  = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.response = response.data;
        throw err;
      }
      return response;
    }

    // Default: 200 mit leerem Body
    return { status: 200, data: {} };
  }

  // Test-Hilfsmethoden
  getRequests()          { return [...this._requests]; }
  getLastRequest()       { return this._requests[this._requests.length - 1]; }
  clearRequests()        { this._requests = []; }
  requestCount()         { return this._requests.length; }
}

module.exports = { InMemoryHttpClient };

'use strict';

/**
 * HttpClient — Interface für HTTP-Requests in Adaptern.
 *
 * Adapter kennen nur dieses Interface — nie fetch/axios direkt.
 * Dadurch: Tests nutzen InMemoryHttpClient, Produktion nutzt RealHttpClient.
 */
class HttpClient {
  /**
   * @param {string} url
   * @param {object} options — method, headers, body
   * @returns {Promise<{status, data}>}
   */
  // eslint-disable-next-line no-unused-vars
  async request(url, options = {}) {
    throw new Error('HttpClient.request() nicht implementiert');
  }

  async get(url, headers = {})         { return this.request(url, { method: 'GET', headers }); }
  async post(url, body, headers = {})  { return this.request(url, { method: 'POST', headers, body }); }
  async patch(url, body, headers = {}) { return this.request(url, { method: 'PATCH', headers, body }); }
}

module.exports = { HttpClient };

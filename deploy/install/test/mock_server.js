'use strict';

// Minimaler Mock des Provisioning-Backends für die lokale Installer-E2E-Harness.
// Antwortet auf /enroll mit nodeId + nodeCredential und auf /heartbeat nur bei
// einem Bearer-Node-Credential (ncr_) mit 200, sonst 401. Bindet 127.0.0.1 an
// einem ephemeren Port und schreibt den Port in die übergebene Datei.
// KEIN echtes Backend, kein Netzwerk-Setup, keine Persistenz.

const http = require('http');
const fs = require('fs');

const portFile = process.argv[2];
const NODE_ID = 'e2e-node-1';
const NODE_CRED = 'ncr_' + 'a'.repeat(64);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    if (req.method === 'POST' && req.url.endsWith('/provisioning/enroll')) {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { nodeId: NODE_ID, nodeCredential: NODE_CRED, serverTime: new Date().toISOString() } }));
      return;
    }
    if (req.method === 'POST' && /\/provisioning\/nodes\/[^/]+\/heartbeat$/.test(req.url)) {
      if (auth.startsWith('Bearer ncr_')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { accepted: true, serverTime: new Date().toISOString() } }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFile, String(server.address().port));
});

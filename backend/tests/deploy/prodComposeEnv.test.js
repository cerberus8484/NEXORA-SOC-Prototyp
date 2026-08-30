const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const prodComposePath = path.join(repoRoot, 'deploy', 'docker-compose.prod.yml');

function readProdCompose() {
  return fs.readFileSync(prodComposePath, 'utf8');
}

describe('production compose environment passthrough', () => {
  it.each([
    'IMAP_HOST',
    'IMAP_PORT',
    'IMAP_TLS',
    'IMAP_USER',
    'IMAP_PASSWORD',
  ])('passes %s into the API container', (name) => {
    const compose = readProdCompose();

    expect(compose).toContain(`${name}:`);
    expect(compose).toContain(`\${${name}:-`);
  });
});

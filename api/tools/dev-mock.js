/**
 * Sobe o mock da Travelfusion e a API apontada para ele, num comando só.
 *
 * Existe porque o erro mais comum de quem clona o repo é rodar `npm run dev`
 * com o `.env` de exemplo: aí a API fala com a Travelfusion de produção, que
 * recusa (IP não whitelistado, senha placeholder) e o sintoma chega como falha
 * de integração. `npm run dev:mock` não tem esse caminho.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const MOCK_PORT = process.env.MOCK_PORT || '3999';
const root = path.resolve(__dirname, '..');

const children = [];

function run(label, command, args, extraEnv) {
  const child = spawn(command, args, {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });

  const prefix = (line) => `[${label}] ${line}`;
  child.stdout.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, prefix('')).trimStart() + ''));
  child.stderr.on('data', (d) => process.stderr.write(String(d).replace(/^/gm, prefix('')).trimStart() + ''));
  child.on('exit', (code) => {
    console.log(prefix(`saiu com código ${code}`));
    shutdown();
  });

  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('mock', 'node', ['tools/mock-travelfusion.js'], { MOCK_PORT });

// Dá um instante para o mock abrir a porta antes da API tentar o Login.
setTimeout(() => {
  run('api', 'npx', ['nest', 'start', '--watch'], {
    TF_ENDPOINT: `http://localhost:${MOCK_PORT}/Xml`,
    TF_XML_LOGIN_ID: process.env.TF_XML_LOGIN_ID || 'passapi',
    TF_PASSWORD: process.env.TF_PASSWORD || 'mock',
  });
}, 1200);

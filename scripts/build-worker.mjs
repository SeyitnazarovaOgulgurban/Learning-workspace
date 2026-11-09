import {mkdir, readFile, writeFile} from 'node:fs/promises';

const types = {
  'index.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'curriculum.js': 'text/javascript; charset=utf-8',
  'learning.js': 'text/javascript; charset=utf-8',
  'accounts.js': 'text/javascript; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
};
const entries = await Promise.all(Object.entries(types).map(async ([file, type]) =>
  [file === 'index.html' ? '/' : '/' + file, {type, body: await readFile('dist/' + file, 'utf8')}]));
const seed = JSON.parse(await readFile('worker/roster-seed.json', 'utf8'));
const source = await readFile('worker/roster-service.mjs', 'utf8');
await mkdir('dist/server', {recursive: true});
await writeFile('dist/server/index.js', [
  'const assets = new Map(' + JSON.stringify(entries) + ');',
  'const initialRoster = ' + JSON.stringify(seed) + ';',
  source,
].join('\n'));

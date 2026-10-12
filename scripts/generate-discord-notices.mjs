import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../discord');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const text = ['Chat On Steroids standalone Discord integration — third-party notices', 'Generated from its separate production lockfile.', ''];
let count = 0;
for (const [relative, item] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!relative || item.dev) continue;
  const directory = path.join(root, relative);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.version !== item.version) throw new Error(`Lockfile mismatch: ${relative}`);
  const names = (await fs.readdir(directory)).filter(name => /^(licen[sc]e|notice|copying|copyright)([._-].*)?$/i.test(name));
  let supplements = [];
  if (!names.length && ['@sapphire/async-queue', '@sapphire/snowflake'].includes(manifest.name)) supplements = [path.join(root, 'licenses/sapphire-LICENSE.md')];
  if (!names.length && !supplements.length) throw new Error(`Missing license text: ${relative}`);
  text.push('='.repeat(72), `${manifest.name}@${manifest.version}`, `Declared license: ${manifest.license}`, '');
  for (const file of [...names.map(name => path.join(directory, name)), ...supplements].sort()) text.push(await fs.readFile(file, 'utf8'), '');
  count++;
}
const output = text.join('\n'), target = path.join(root, 'THIRD-PARTY-NOTICES.txt');
if (process.argv.includes('--check')) {
  if (await fs.readFile(target, 'utf8') !== output) throw new Error('Discord notices are stale; regenerate them.');
} else await fs.writeFile(target, output);
console.log(`Validated Discord license notices for ${count} production packages.`);

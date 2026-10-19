import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBuild } from './headless-provenance.mjs';
let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), payload = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--payload') payload = true;
  else if (process.argv[i] === '--root' && path.isAbsolute(process.argv[i + 1] ?? '')) root = process.argv[++i];
  else throw new Error('Use --root ABSOLUTE_PATH [--payload]');
}
try {
  const manifest = await verifyBuild(root, payload);
  console.log(`Verified Headless ${payload ? 'payload' : 'source and payload'}: ${manifest.commit}`);
} catch (error) { console.error(`Headless build rejected: ${error.message}`); process.exitCode = 1; }

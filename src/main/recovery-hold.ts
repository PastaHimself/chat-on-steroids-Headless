import { promises as fs } from 'node:fs';
import path from 'node:path';

let held = false;
/** Only the local stopped-stack restore workflow creates or releases this latch. */
export async function initRecoveryHold(directory: string): Promise<void> {
  held = false;
  try {
    const file = path.join(directory, 'restore-hold.json');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) { held = true; return; }
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    held = value.version !== 1 || value.held !== false;
  } catch (error) { held = (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
}
export function recoveryHeld(): boolean { return held; }
export function resetRecoveryHoldForTests(): void { held = false; }

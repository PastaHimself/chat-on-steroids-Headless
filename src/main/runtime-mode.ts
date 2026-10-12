import path from 'node:path';

export type RuntimeMode = 'desktop' | 'headless';

/** Server mode keeps Electron's service owners but creates no workspace renderer. */
export function runtimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const value = env.COS_RUNTIME_MODE ?? 'desktop';
  if (value !== 'desktop' && value !== 'headless') throw new Error('COS_RUNTIME_MODE must be desktop or headless');
  return value;
}

export function validateHeadlessEnvironment(env: NodeJS.ProcessEnv = process.env, platform = process.platform): void {
  if (runtimeMode(env) !== 'headless') return;
  if (platform !== 'linux') throw new Error('The supported headless runtime requires Linux');
  if (!env.DISPLAY) throw new Error('Headless Electron and the companion browser require a virtual display (Xvfb)');
  for (const key of ['COS_DATA_DIR', 'COS_BROWSER_PROFILE'] as const) {
    if (!env[key] || !path.isAbsolute(env[key]!)) throw new Error(`${key} must be an absolute path in headless mode`);
  }
}

/** Local bootstrap grants. Discord cannot widen them. allowActions still governs every mutation. */
export function remotePermission(permission: 'send' | 'configure' | 'plan' | 'workers', env = process.env): boolean {
  return (env.COS_REMOTE_PERMISSIONS ?? '').split(',').map(value => value.trim()).includes(permission);
}

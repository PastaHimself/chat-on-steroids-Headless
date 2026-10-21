// Tests use synthetic provider responses and ephemeral loopback bridge servers.
// A forgotten provider mock must fail locally rather than disclose fixture data.
const syntheticOrigins = new Set<string>();
/** A local fake proxy may use only this reserved, non-resolving fixture host. */
export function allowSyntheticProxyOrigin(origin: string): () => void {
  const url = new URL(origin);
  if (url.hostname !== 'updates.invalid' || url.protocol !== 'http:' || !url.port)
    throw new TypeError('Only the reserved local proxy fixture origin can be admitted');
  syntheticOrigins.add(url.origin);
  return () => { syntheticOrigins.delete(url.origin); };
}
const fetchLoopback = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !syntheticOrigins.has(url.origin))
    throw new TypeError(`Unexpected external fetch in isolated test: ${url.origin}`);
  return fetchLoopback(input, init);
};

// Tests use synthetic provider responses and ephemeral loopback bridge servers.
// A forgotten provider mock must fail locally rather than disclose fixture data.
const fetchLoopback = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new TypeError(`Unexpected external fetch in isolated test: ${url.origin}`);
  return fetchLoopback(input, init);
};

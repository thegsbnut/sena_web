// Structured error logging for Workers Logs (see "observability" in wrangler.jsonc).
// Logs only the error and the context passed in: never request bodies, cookies,
// tokens or LINE user IDs.
export function logError(context, error, extra = {}) {
  const clean = value =>
    String(value ?? '')
      .replace(/U[a-f0-9]{32}/g, '[LINE_USER_ID]')
      .slice(0, 2000);
  console.error(
    JSON.stringify({
      level: 'error',
      context,
      name: error?.name || 'Error',
      message: clean(error?.message ?? error),
      stack: clean(error?.stack),
      ...extra,
    }),
  );
}

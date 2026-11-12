// Builds the redesign preview: copies public/ into dist-next/, then overlays next/.
// Production (wrangler.jsonc → public/) is untouched; only wrangler.next.jsonc serves dist-next/.
import { cpSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function buildNext(out = root + 'dist-next') {
  // Empty the folder instead of deleting it, so a running `wrangler dev` keeps watching it.
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) rmSync(out + '/' + name, { recursive: true, force: true });
  cpSync(root + 'public', out, { recursive: true });
  cpSync(root + 'next', out, { recursive: true });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log('built', buildNext());

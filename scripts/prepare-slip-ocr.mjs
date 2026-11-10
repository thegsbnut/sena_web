import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'));
const destination = fileURLToPath(new URL('../public/vendor/slip-ocr/', import.meta.url));
const assets = [
 ...['tesseract.esm.min.js', 'worker.min.js', 'worker.min.js.LICENSE.txt', 'tesseract.min.js.LICENSE.txt']
  .map(name => join(tesseract, 'dist', name)),
 ...['', '-simd', '-relaxedsimd'].map(variant => join(core, 'tesseract-core' + variant + '-lstm.wasm.js')),
 join(core, 'LICENSE'),
 ...['tha', 'eng'].map(lang => join(dirname(require.resolve('@tesseract.js-data/' + lang + '/package.json')),
  '4.0.0_best_int', lang + '.traineddata.gz'))
];
await mkdir(destination, { recursive: true });
await Promise.all(assets.map(file => copyFile(file, join(destination, basename(file)))));

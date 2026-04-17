import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Parcel } from '@parcel/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
  const bundler = new Parcel({
    entries: 'src/index.html',
    defaultConfig: '@parcel/config-default',
    mode: 'development',
    defaultTargetOptions: { distDir: 'dist' },
  });

  await bundler.watch((err) => {
    if (err) console.error('Parcel build error:', err.diagnostics);
    else console.log('Parcel build successful');
  });

  const app = express();

  // Required for SharedArrayBuffer (wasm threading).
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
  });

  app.use(express.static(join(__dirname, 'dist')));

  const port = process.env.PORT || 3100;
  app.listen(port, () => console.log(`Smoke test running on http://localhost:${port}`));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

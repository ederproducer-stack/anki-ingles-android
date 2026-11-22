/*
 * Gera www/native-bundle.js a partir de src/native.js.
 * Roda antes de `cap sync`, para o WebView carregar as APIs nativas como IIFE.
 */
const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

esbuild
  .buildSync({
    entryPoints: [path.join(root, 'src/native.js')],
    outfile: path.join(root, 'www/native-bundle.js'),
    bundle: true,
    format: 'iife',
    target: ['es2017'],
    minify: false,
    logLevel: 'info'
  });

const fs = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const pkg     = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const htmlPath = path.join(root, 'index.html');

let html = fs.readFileSync(htmlPath, 'utf8');

// Replace content of <span id="app-version">...</span>
const updated = html.replace(
  /(<span id="app-version">)[^<]*(<\/span>)/,
  `$1v${pkg.version}$2`
);

if (updated === html) {
  console.error('❌ Marker <span id="app-version"> not found in index.html');
  process.exit(1);
}

fs.writeFileSync(htmlPath, updated);
console.log(`✅ Version v${pkg.version} injected into index.html`);

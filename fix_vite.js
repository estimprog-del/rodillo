const fs = require('fs');
let content = fs.readFileSync('vite.config.js', 'utf8');
// Insert minify: 'terser', after server: { host: true },
content = content.replace(
  "server: { host: true },\n    esbuild: { drop: ['console', 'debugger'] },",
  "server: { host: true },\n    minify: 'terser',\n    esbuild: { drop: ['console', 'debugger'] },"
);
fs.writeFileSync('vite.config.js', content);
console.log('Done - vite.config.js updated');
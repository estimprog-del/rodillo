const fs = require('fs');
let content = fs.readFileSync('vite.config.js', 'utf8');
// Try multiple patterns
let replaced = false;

// Pattern 1: with \n
let pattern1 = "server: { host: true },\r\n    esbuild: { drop: ['console', 'debugger'] },";
let replacement1 = "server: { host: true },\r\n    minify: 'terser',\r\n    esbuild: { drop: ['console', 'debugger'] },";

if (content.includes(pattern1)) {
  content = content.replace(pattern1, replacement1);
  replaced = true;
  console.log('Pattern 1 matched');
} else {
  console.log('Pattern 1 NOT matched');
}

// Pattern 2: with just \n
let pattern2 = "server: { host: true },\n    esbuild: { drop: ['console', 'debugger'] },";
let replacement2 = "server: { host: true },\n    minify: 'terser',\n    esbuild: { drop: ['console', 'debugger'] },";

if (content.includes(pattern2) && !replaced) {
  content = content.replace(pattern2, replacement2);
  replaced = true;
  console.log('Pattern 2 matched');
} else {
  console.log('Pattern 2 NOT matched');
}

// Pattern 3: just search for the server line and insert
if (!replaced) {
  // Find "server: { host: true }," and add minify after it
  const idx = content.indexOf("server: { host: true },");
  if (idx !== -1) {
    const after = content.indexOf("\n", idx);
    const insertPos = after + 1;
    const minifyLine = "    minify: 'terser',\n";
    content = content.slice(0, insertPos) + minifyLine + content.slice(insertPos);
    replaced = true;
    console.log('Pattern 3 matched at position', insertPos);
  }
}

if (replaced) {
  fs.writeFileSync('vite.config.js', content);
  console.log('vite.config.js updated successfully');
} else {
  console.log('No pattern matched - checking file content...');
  // Show what's around line 191
  const lines = content.split('\n');
  for (let i = 188; i < 200; i++) {
    console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
  }
}
#!/usr/bin/env node

// Quick script to verify build output has correct paths
const fs = require('fs');
const path = require('path');

const distPath = path.join(process.cwd(), 'dist');
const indexPath = path.join(distPath, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('❌ dist/index.html not found. Run npm run build first.');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf-8');

// Check if asset paths include /sunny/ base
const hasCorrectBase = html.includes('/sunny/') || html.includes('"./') || html.includes("'./");

if (!hasCorrectBase && html.includes('src="/') && !html.includes('src="/sunny/')) {
  console.error('❌ Build output has incorrect asset paths!');
  console.error('Expected paths to include /sunny/ base path.');
  console.error('\nFirst few asset references found:');
  const assetMatches = html.match(/src="[^"]+"/g) || [];
  console.error(assetMatches.slice(0, 3).join('\n'));
  process.exit(1);
}

console.log('✅ Build output looks correct!');
console.log('Asset paths appear to have correct base path.');


// Rasterizes images/icon-source.svg → images/icon.png (256x256) for the Marketplace listing.
// Run with: npm run gen:icon
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'images', 'icon-source.svg'));
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
fs.writeFileSync(path.join(root, 'images', 'icon.png'), png);
console.log('wrote images/icon.png (' + png.length + ' bytes)');

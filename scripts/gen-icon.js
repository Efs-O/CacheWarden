// Rasterizes the SVG sources into PNGs. Run with: npm run gen:icon
//   images/icon-source.svg   -> images/icon.png            (256x256, Marketplace listing)
//   images/social-source.svg -> images/social-preview.png  (1280x640, GitHub social preview)
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');

function render(srcName, outName, width) {
  const svg = fs.readFileSync(path.join(root, 'images', srcName));
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
  }).render().asPng();
  fs.writeFileSync(path.join(root, 'images', outName), png);
  console.log('wrote images/' + outName + ' (' + png.length + ' bytes)');
}

render('icon-source.svg', 'icon.png', 256);
render('social-source.svg', 'social-preview.png', 1280);

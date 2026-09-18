const fs = require('fs');
const path = 'E:/Telechargement/EMULADORDENEOGEO/NeoRAGEx_5.0/NEO GEO/NeoRAGEx_5.0/NeoRAGEx 5.0.exe';

if (!fs.existsSync(path)) {
  console.log('File not found:', path);
  process.exit(1);
}

const buf = fs.readFileSync(path);
console.log('Size:', buf.length);

const str = buf.toString('latin1');
const matches = str.match(/neoragex[^\x00\r\n\t ]*/gi) || [];
console.log('neoragex occurrences:', [...new Set(matches)]);

const cmdMatches = str.match(/\/[a-zA-Z0-9_\-]+|\-[a-zA-Z0-9_\-]+/g) || [];
console.log('Flag patterns:', [...new Set(cmdMatches.filter(m => m.length > 2 && m.length < 15))].slice(0, 30));

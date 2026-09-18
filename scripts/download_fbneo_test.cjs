const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function testDownload() {
  console.log('Downloading androdun.zip from archive.org...');
  const res = await fetch('https://archive.org/download/neo-geo-mvs-romset/androdun.zip');
  if (!res.ok) {
    console.error('Download failed:', res.status);
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const dest = path.resolve(__dirname, '../public/roms/androdun.zip');
  fs.writeFileSync(dest, buffer);
  console.log('Downloaded. Size:', buffer.length);
  console.log('Contents of modern androdun.zip:');
  execSync(`tar -tf "${dest}"`, { stdio: 'inherit' });
}
testDownload();

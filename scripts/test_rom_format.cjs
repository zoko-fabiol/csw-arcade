const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const temp = path.resolve(__dirname, '../temp_andro');
fs.mkdirSync(temp, { recursive: true });

const srcZip = path.resolve(__dirname, '../public/roms/androdunos.zip');
execSync(`tar -xf "${srcZip}" -C "${temp}"`);

const files = fs.readdirSync(temp);
for (const f of files) {
  if (f.endsWith('.rom')) {
    const base = f.replace('.rom', '');
    fs.copyFileSync(path.join(temp, f), path.join(temp, base + '.bin'));
  }
}

const target = path.resolve(__dirname, '../public/roms/androdun.zip');
if (fs.existsSync(target)) fs.unlinkSync(target);

execSync(`tar -a -cf "${target}" *`, { cwd: temp });
fs.rmSync(temp, { recursive: true, force: true });

console.log('SUCCESS: Created androdun.zip with .bin and .rom files. Files:');
execSync(`tar -tf "${target}"`, { stdio: 'inherit' });

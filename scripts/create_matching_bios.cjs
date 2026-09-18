const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const temp = path.resolve(__dirname, '../temp_mvs_bios');
if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
fs.mkdirSync(temp, { recursive: true });

const androZip = path.resolve(__dirname, '../public/roms/androdun.zip');
execSync(`tar -xf "${androZip}" -C "${temp}"`);

const biosFiles = [
  '000-lo.lo', 'sfix.sfix', 'sm1.sm1', 'sp-s2.sp1', 'sp-s.sp1',
  'sp-u2.sp1', 'sp-e.sp1', 'sp-j2.sp1', 'asia-s3.rom', 'japan-j3.bin',
  'sp1.jipan.1024', 'sp-45.sp1', 'sp-1v1_3db8c.bin',
  'uni-bios_1_0.rom', 'uni-bios_1_1.rom', 'uni-bios_1_2.rom', 'uni-bios_1_3.rom',
  'uni-bios_2_0.rom', 'uni-bios_2_1.rom', 'uni-bios_2_2.rom', 'uni-bios_2_3.rom',
  'uni-bios_3_0.rom', 'uni-bios_3_1.rom', 'uni-bios_3_2.rom',
  'v2.bin', 'vs-bios.rom'
];

// Add neo-geo.rom alias if sp-s2.sp1 is present
if (fs.existsSync(path.join(temp, 'sp-s2.sp1'))) {
  fs.copyFileSync(path.join(temp, 'sp-s2.sp1'), path.join(temp, 'neo-geo.rom'));
}

for (const f of fs.readdirSync(temp)) {
  if (!biosFiles.includes(f) && f !== 'neo-geo.rom') {
    fs.unlinkSync(path.join(temp, f));
  }
}

console.log('Files inside new neogeo.zip:', fs.readdirSync(temp));
const biosZip = path.resolve(__dirname, '../public/roms/neogeo.zip');
if (fs.existsSync(biosZip)) fs.unlinkSync(biosZip);
execSync(`tar -a -cf "${biosZip}" *`, { cwd: temp });
fs.rmSync(temp, { recursive: true, force: true });
console.log('SUCCESS: neogeo.zip created. Size:', fs.statSync(biosZip).size);

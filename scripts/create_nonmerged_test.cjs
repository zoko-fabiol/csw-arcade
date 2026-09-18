const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const temp = path.resolve(__dirname, '../temp_nonmerged');
if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
fs.mkdirSync(temp, { recursive: true });

const androZip = path.resolve(__dirname, '../public/roms/androdun.zip');
const biosZip = path.resolve(__dirname, '../public/roms/neogeo.zip');

execSync(`tar -xf "${androZip}" -C "${temp}"`);
execSync(`tar -xf "${biosZip}" -C "${temp}"`);

console.log('Files in non-merged set:', fs.readdirSync(temp));

if (fs.existsSync(androZip)) fs.unlinkSync(androZip);
execSync(`tar -a -cf "${androZip}" *`, { cwd: temp });
fs.rmSync(temp, { recursive: true, force: true });

console.log('SUCCESS: androdun.zip is now a standalone Non-Merged set! Size:', fs.statSync(androZip).size);

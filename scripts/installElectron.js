import { downloadArtifact } from '@electron/get';
import extract from 'extract-zip';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Downloading Electron binary...');
  const zipPath = await downloadArtifact({
    version: '30.0.9',
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64'
  });
  console.log('Downloaded zip to:', zipPath);
  console.log('Extracting to node_modules/electron/dist...');
  await extract(zipPath, { dir: path.resolve('node_modules/electron/dist') });
  await fs.promises.writeFile(path.resolve('node_modules/electron/path.txt'), 'electron.exe');
  console.log('Electron successfully installed!');
}

main().catch(err => {
  console.error('Error installing electron:', err);
  process.exit(1);
});

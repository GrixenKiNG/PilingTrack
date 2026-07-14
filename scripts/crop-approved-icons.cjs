const path = require('node:path');
const sharp = require('sharp');

const source = path.join(process.cwd(), 'public', 'icons', 'pilingtrack', 'approved-icon-sheet.png');
const outputDir = path.dirname(source);
const names = [
  'shift-start', 'inspection', 'engine-hours', 'defect', 'camera', 'send',
  'pile-group', 'pile-driving', 'drilling-auger', 'linear-meters', 'downtime', 'downtime-reason',
  'technical-readiness', 'maintenance-due', 'repair', 'work-order', 'spare-parts', 'accepted',
  'site', 'equipment-rig', 'crew', 'operator', 'dispatcher', 'administrator',
  'monitoring', 'reports', 'history', 'analytics', 'risk', 'notifications',
  'documents', 'users', 'settings', 'folder', 'telegram', 'logout',
];

async function main() {
  await Promise.all(names.map((name, index) => sharp(source)
    .extract({
      left: (index % 6) * 209,
      top: Math.floor(index / 6) * 209,
      width: 209,
      height: 184,
    })
    .png()
    .toFile(path.join(outputDir, `${name}.png`))));

  console.log(`Created ${names.length} approved icon assets.`);
}

void main();

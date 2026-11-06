const DB = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(process.cwd(), '.data');
const DB_PATH = path.join(BACKUP_DIR, 'atlas.db');
const SNAPSHOTS_DIR = path.join(BACKUP_DIR, 'snapshots');

if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

try {
  const db = new DB(DB_PATH);
  const snapshots = db.prepare("SELECT filename, data FROM snapshots_v2").all();
  for (const snap of snapshots) {
    const filePath = path.join(SNAPSHOTS_DIR, snap.filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, snap.data, 'utf-8');
      console.log(`Restored snapshot file: ${snap.filename}`);
    }
  }
} catch (e) {
  console.log("Error restoring snapshots:", e.message);
}

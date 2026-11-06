const fs = require('fs');
const path = require('path');
let code = fs.readFileSync('src/backend/db.ts', 'utf-8');
code = code.replace(
  "    console.log(`Created custom snapshot in database: ${filename}`);",
  `    if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), rawData, 'utf-8');
    console.log(\`Created custom snapshot in database and file system: \${filename}\`);`
);
code = code.replace(
  "    db.prepare('DELETE FROM snapshots_v2 WHERE filename = ?').run(filename);\n    console.log(`Deleted snapshot: ${filename}`);",
  `    db.prepare('DELETE FROM snapshots_v2 WHERE filename = ?').run(filename);
    const filepath = path.join(SNAPSHOTS_DIR, filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    console.log(\`Deleted snapshot: \${filename}\`);`
);
fs.writeFileSync('src/backend/db.ts', code);

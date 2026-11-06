const fs = require('fs');
let code = fs.readFileSync('src/backend/db.ts', 'utf-8');

const oldLogic = `      if (files.length > 0) {
        console.log(\`Found \${files.length} snapshot files on disk. Migrating to snapshots_v2 table...\`);
        for (const file of files) {
          try {
            const filePath = path.join(SNAPSHOTS_DIR, file);
            const raw = fs.readFileSync(filePath, 'utf-8');`;

const newLogic = `      const existingDbFiles = new Set(
        db.prepare('SELECT filename FROM snapshots_v2').all().map((r) => r.filename)
      );
      const newFiles = files.filter(f => !existingDbFiles.has(f));

      if (newFiles.length > 0) {
        console.log(\`Found \${newFiles.length} NEW snapshot files on disk. Syncing to snapshots_v2 table...\`);
        for (const file of newFiles) {
          try {
            const filePath = path.join(SNAPSHOTS_DIR, file);
            const raw = fs.readFileSync(filePath, 'utf-8');`;

code = code.replace(oldLogic, newLogic);
fs.writeFileSync('src/backend/db.ts', code);

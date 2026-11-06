import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const BACKUP_DIR = path.join(process.cwd(), '.data');
const DB_PATH = path.join(BACKUP_DIR, 'atlas.db');
const JSON_BACKUP_PATH = path.join(BACKUP_DIR, 'backup_atlas.json');
const BINARY_BACKUP_PATH = path.join(BACKUP_DIR, 'atlas.db.bak');

const SECONDARY_JSON_BACKUP_PATH = path.join(process.cwd(), 'backup_atlas.json');
const SNAPSHOTS_DIR = path.join(BACKUP_DIR, 'snapshots');
const SECONDARY_SNAPSHOTS_DIR = path.join(process.cwd(), 'snapshots_backup');

function saveSnapshotToDiskFolders(filename: string, rawJsonContent: string) {
  try {
    if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), rawJsonContent, 'utf-8');
  } catch (e) {
    console.error(`Failed writing snapshot to primary dir (${SNAPSHOTS_DIR}):`, e);
  }

  try {
    if (!fs.existsSync(SECONDARY_SNAPSHOTS_DIR)) fs.mkdirSync(SECONDARY_SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SECONDARY_SNAPSHOTS_DIR, filename), rawJsonContent, 'utf-8');
  } catch (e) {
    console.error(`Failed writing snapshot to secondary dir (${SECONDARY_SNAPSHOTS_DIR}):`, e);
  }
}

function deleteSnapshotFromDiskFolders(filename: string) {
  try {
    const p1 = path.join(SNAPSHOTS_DIR, filename);
    if (fs.existsSync(p1)) fs.unlinkSync(p1);
  } catch (e) {}

  try {
    const p2 = path.join(SECONDARY_SNAPSHOTS_DIR, filename);
    if (fs.existsSync(p2)) fs.unlinkSync(p2);
  } catch (e) {}
}

// Migrate existing root database to the persistent .data directory if needed
const ROOT_DB_PATH = path.join(process.cwd(), 'atlas.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(ROOT_DB_PATH)) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    fs.copyFileSync(ROOT_DB_PATH, DB_PATH);
    console.log("Migrated root database atlas.db to persistent .data/atlas.db successfully.");
    // Copy WAL files too if they exist
    const rootWal = ROOT_DB_PATH + '-wal';
    const destWal = DB_PATH + '-wal';
    if (fs.existsSync(rootWal)) {
      fs.copyFileSync(rootWal, destWal);
    }
    const rootShm = ROOT_DB_PATH + '-shm';
    const destShm = DB_PATH + '-shm';
    if (fs.existsSync(rootShm)) {
      fs.copyFileSync(rootShm, destShm);
    }
  } catch (err) {
    console.error("Failed to migrate root database to .data/atlas.db:", err);
  }
}

let backupTimeout: any = null;

export function backupDatabase() {
  if (backupTimeout) {
    clearTimeout(backupTimeout);
  }
  backupTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }
      
      // JSON backup (extremely robust, text-based)
      const data: any = {
        entities: db.prepare('SELECT * FROM entities').all(),
        relationships: db.prepare('SELECT * FROM relationships').all(),
        pending_relationships: db.prepare('SELECT * FROM pending_relationships').all(),
        sub_clusters: db.prepare('SELECT * FROM sub_clusters').all()
      };

      try {
        syncDiskSnapshotsToDb();
        data.snapshots_v2 = db.prepare('SELECT * FROM snapshots_v2').all();
      } catch (e) {
        // Table doesn't exist yet
      }

      try {
        data.deleted_entities = db.prepare('SELECT * FROM deleted_entities').all();
      } catch (e) {
        // Table doesn't exist yet
      }

      // Safeguard: If the existing backup has MORE entities than our current database,
      // create a safety archive of the existing backup file first so we don't lose history!
      if (fs.existsSync(JSON_BACKUP_PATH)) {
        try {
          const oldRaw = fs.readFileSync(JSON_BACKUP_PATH, 'utf-8');
          const oldData = JSON.parse(oldRaw);
          if (oldData && Array.isArray(oldData.entities) && oldData.entities.length > data.entities.length) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const historyPath = path.join(BACKUP_DIR, `backup_atlas_pre_drop_${timestamp}.json`);
            fs.writeFileSync(historyPath, oldRaw, 'utf-8');
            console.log(`[Safety Backup] Saved historical database state (${oldData.entities.length} entities) to ${historyPath} before updating with smaller state (${data.entities.length} entities).`);
          }
        } catch (backupErr: any) {
          // If the backup file is malformed, log a safe warning instead of console.error to avoid error noise,
          // and move the corrupted file to a safe location.
          console.warn(`[Safety Backup] Existing backup file is malformed or incomplete (${backupErr?.message || backupErr}). Archiving corrupted backup file.`);
          try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const corruptedPath = path.join(BACKUP_DIR, `backup_atlas_corrupted_${timestamp}.json`);
            fs.renameSync(JSON_BACKUP_PATH, corruptedPath);
          } catch (renameErr) {
            // ignore rename failure
          }
        }
      }

      // Checkpoint WAL to main DB file before making the binary copy, ensuring the copy has all latest data
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (checkpointErr) {
        console.warn("Failed to checkpoint WAL before binary backup:", checkpointErr);
      }

      // Binary backup (Atomic write using temp file + atomic rename)
      try {
        if (fs.existsSync(DB_PATH)) {
          const tempBinaryPath = BINARY_BACKUP_PATH + '.tmp';
          fs.copyFileSync(DB_PATH, tempBinaryPath);
          fs.renameSync(tempBinaryPath, BINARY_BACKUP_PATH);
        }
      } catch (err) {
        console.error("Failed to copy binary backup:", err);
      }

      // Atomic JSON backup file write to avoid corruption on process termination
      const tempJsonPath = JSON_BACKUP_PATH + '.tmp';
      const jsonContent = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempJsonPath, jsonContent, 'utf-8');
      fs.renameSync(tempJsonPath, JSON_BACKUP_PATH);

      // Write secondary JSON backup outside .data to prevent loss
      try {
        const tempSecPath = SECONDARY_JSON_BACKUP_PATH + '.tmp';
        fs.writeFileSync(tempSecPath, jsonContent, 'utf-8');
        fs.renameSync(tempSecPath, SECONDARY_JSON_BACKUP_PATH);
      } catch (secErr) {
        console.error("Failed to write secondary JSON backup:", secErr);
      }

      console.log("Database backup saved successfully!");
    } catch (err) {
      console.error("Failed to back up database:", err);
    }
    backupTimeout = null;
  }, 1000);
}

export function restoreDatabaseFromBackup(d: any) {
  try {
    let jsonRestored = false;
    let backupFileToRead = fs.existsSync(JSON_BACKUP_PATH) ? JSON_BACKUP_PATH : (fs.existsSync(SECONDARY_JSON_BACKUP_PATH) ? SECONDARY_JSON_BACKUP_PATH : null);
    
    if (backupFileToRead) {
      console.log(`Restoring database from JSON backup (${backupFileToRead})...`);
      try {
        const raw = fs.readFileSync(backupFileToRead, 'utf-8');
        const data = JSON.parse(raw);
        
        d.exec('BEGIN TRANSACTION');
        try {
          d.exec('DELETE FROM entities');
          d.exec('DELETE FROM relationships');
          d.exec('DELETE FROM pending_relationships');
          d.exec('DELETE FROM sub_clusters');

          if (Array.isArray(data.entities)) {
            const stmt = d.prepare(`
              INSERT INTO entities (id, title, type, domain, scale, description, tags, content, permalink, stage, relevance, x, y, sub_idx, file_path, pinned)
              VALUES (@id, @title, @type, @domain, @scale, @description, @tags, @content, @permalink, @stage, @relevance, @x, @y, @sub_idx, @file_path, @pinned)
            `);
            for (const item of data.entities) {
              stmt.run({
                id: item.id,
                title: item.title || 'Untitled',
                type: item.type || 'note',
                domain: item.domain || 'uncategorized',
                scale: item.scale || 'street',
                description: item.description || '',
                tags: typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags || []),
                content: item.content || '',
                permalink: item.permalink || '',
                stage: item.stage || '',
                relevance: item.relevance || 0,
                x: item.x || 0,
                y: item.y || 0,
                sub_idx: item.sub_idx !== undefined ? item.sub_idx : null,
                file_path: item.file_path !== undefined ? item.file_path : null,
                pinned: item.pinned !== undefined ? item.pinned : 0
              });
            }
          }

          if (Array.isArray(data.relationships)) {
            const stmt = d.prepare(`
              INSERT INTO relationships (id, source, target, type, weight, evidence, visible)
              VALUES (@id, @source, @target, @type, @weight, @evidence, @visible)
            `);
            for (const item of data.relationships) {
              stmt.run({
                id: item.id,
                source: item.source,
                target: item.target,
                type: item.type || 'references',
                weight: item.weight || 1,
                evidence: item.evidence || '',
                visible: item.visible ? 1 : 0
              });
            }
          }

          if (Array.isArray(data.pending_relationships)) {
            const stmt = d.prepare(`
              INSERT INTO pending_relationships (id, source, target, type, weight, evidence, status, visible)
              VALUES (@id, @source, @target, @type, @weight, @evidence, @status, @visible)
            `);
            for (const item of data.pending_relationships) {
              stmt.run({
                id: item.id,
                source: item.source,
                target: item.target,
                type: item.type,
                weight: item.weight || 1,
                evidence: item.evidence || '',
                status: item.status || 'pending',
                visible: item.visible ? 1 : 0
              });
            }
          }

          if (Array.isArray(data.sub_clusters)) {
            const stmt = d.prepare(`
              INSERT INTO sub_clusters (domain, sub_idx, title, x, y, angle, parent_sub_idx)
              VALUES (@domain, @sub_idx, @title, @x, @y, @angle, @parent_sub_idx)
            `);
            for (const item of data.sub_clusters) {
              stmt.run({
                domain: item.domain,
                sub_idx: item.sub_idx,
                title: item.title,
                x: item.x !== undefined ? item.x : null,
                y: item.y !== undefined ? item.y : null,
                angle: item.angle !== undefined ? item.angle : null,
                parent_sub_idx: item.parent_sub_idx !== undefined ? item.parent_sub_idx : null
              });
            }
          }

          if (Array.isArray(data.snapshots_v2)) {
            try {
              d.exec('DELETE FROM snapshots_v2');
              const stmt = d.prepare(`
                INSERT INTO snapshots_v2 (filename, timestamp, name, data, entity_count, relationship_count, pending_count, size_bytes)
                VALUES (@filename, @timestamp, @name, @data, @entity_count, @relationship_count, @pending_count, @size_bytes)
              `);
              for (const item of data.snapshots_v2) {
                stmt.run({
                  filename: item.filename,
                  timestamp: item.timestamp,
                  name: item.name,
                  data: item.data,
                  entity_count: item.entity_count !== undefined ? item.entity_count : 0,
                  relationship_count: item.relationship_count !== undefined ? item.relationship_count : 0,
                  pending_count: item.pending_count !== undefined ? item.pending_count : 0,
                  size_bytes: item.size_bytes !== undefined ? item.size_bytes : 0
                });
              }
              console.log(`Restored ${data.snapshots_v2.length} snapshots from JSON backup.`);
            } catch (snapErr) {
              console.error("Failed to restore snapshots_v2:", snapErr);
            }
          }

          if (Array.isArray(data.deleted_entities)) {
            try {
              d.exec('DELETE FROM deleted_entities');
              const stmt = d.prepare(`
                INSERT OR REPLACE INTO deleted_entities (id, file_path, relative_path, filename, title, deleted_at)
                VALUES (@id, @file_path, @relative_path, @filename, @title, @deleted_at)
              `);
              for (const item of data.deleted_entities) {
                stmt.run({
                  id: item.id,
                  file_path: item.file_path || '',
                  relative_path: item.relative_path || '',
                  filename: item.filename || '',
                  title: item.title || '',
                  deleted_at: item.deleted_at || new Date().toISOString()
                });
              }
              console.log(`Restored ${data.deleted_entities.length} deleted entities from JSON backup.`);
            } catch (delErr) {
              console.error("Failed to restore deleted_entities:", delErr);
            }
          }

          d.exec('COMMIT');
          console.log("Database restored from JSON backup successfully!");
          jsonRestored = true;
        } catch (err) {
          d.exec('ROLLBACK');
          console.error("Transaction failed during JSON backup restore:", err);
        }
      } catch (parseErr) {
        console.warn("[Restore System] JSON backup file is corrupted or unreadable. Will attempt binary backup fallback.", parseErr);
      }
    }

    if (jsonRestored) {
      return true;
    }

    if (fs.existsSync(BINARY_BACKUP_PATH)) {
      console.log("Attempting restore from binary backup...");
      try {
        fs.copyFileSync(BINARY_BACKUP_PATH, DB_PATH);
        console.log("Database restored from binary backup successfully!");
        return true;
      } catch (err) {
        console.error("Binary backup restore failed:", err);
      }
    }
  } catch (err) {
    console.error("Failed to restore database from backup:", err);
  }
  return false;
}

export function syncDiskSnapshotsToDb(d?: any) {
  const dbConn = d || db;
  try {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(SECONDARY_SNAPSHOTS_DIR)) {
      fs.mkdirSync(SECONDARY_SNAPSHOTS_DIR, { recursive: true });
    }

    // 1. Get existing snapshot filenames in database
    let existingDbFilenames = new Set<string>();
    try {
      const existingDbRows = dbConn.prepare('SELECT filename FROM snapshots_v2').all() as any[];
      existingDbFilenames = new Set(existingDbRows.map((r: any) => r.filename));
    } catch (e) {
      // Table might not exist yet during early init
    }

    // 2. Read snapshot JSON files from BOTH primary and secondary disk folders
    const primaryFiles = fs.existsSync(SNAPSHOTS_DIR) ? fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith('.json')) : [];
    const secondaryFiles = fs.existsSync(SECONDARY_SNAPSHOTS_DIR) ? fs.readdirSync(SECONDARY_SNAPSHOTS_DIR).filter(f => f.endsWith('.json')) : [];
    const allFiles = Array.from(new Set([...primaryFiles, ...secondaryFiles]));

    for (const file of allFiles) {
      let raw: string | null = null;
      let fileStat: fs.Stats | null = null;
      const p1 = path.join(SNAPSHOTS_DIR, file);
      const p2 = path.join(SECONDARY_SNAPSHOTS_DIR, file);

      if (fs.existsSync(p1)) {
        try {
          raw = fs.readFileSync(p1, 'utf-8');
          fileStat = fs.statSync(p1);
        } catch (e) {}
      }
      if (!raw && fs.existsSync(p2)) {
        try {
          raw = fs.readFileSync(p2, 'utf-8');
          fileStat = fs.statSync(p2);
        } catch (e) {}
      }

      if (raw) {
        // Ensure snapshot exists in BOTH disk locations
        saveSnapshotToDiskFolders(file, raw);

        if (!existingDbFilenames.has(file)) {
          try {
            const data = JSON.parse(raw);
            const entity_count = Array.isArray(data.entities) ? data.entities.length : 0;
            const relationship_count = Array.isArray(data.relationships) ? data.relationships.length : 0;
            const pending_count = Array.isArray(data.pending_relationships)
              ? data.pending_relationships.filter((p: any) => p.status === 'pending').length
              : 0;

            dbConn.prepare(`
              INSERT OR REPLACE INTO snapshots_v2 (filename, timestamp, name, data, entity_count, relationship_count, pending_count, size_bytes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              file,
              data.timestamp || (fileStat ? fileStat.mtime.toISOString() : new Date().toISOString()),
              data.name || 'Unnamed Snapshot',
              raw,
              entity_count,
              relationship_count,
              pending_count,
              fileStat ? fileStat.size : Buffer.byteLength(raw, 'utf-8')
            );
            console.log(`[Snapshot Sync] Imported snapshot '${file}' into database table from disk.`);
          } catch (err) {
            console.error(`[Snapshot Sync] Error importing snapshot file ${file}:`, err);
          }
        }
      }
    }

    // 3. Reverse sync: Export any snapshot records in database to BOTH disk folders if missing
    try {
      const allDbSnaps = dbConn.prepare('SELECT filename, data FROM snapshots_v2').all() as any[];
      for (const snap of allDbSnaps) {
        if (snap.filename && snap.data) {
          saveSnapshotToDiskFolders(snap.filename, snap.data);
        }
      }
    } catch (e) {}
  } catch (err) {
    console.error("[Snapshot Sync] Error syncing disk snapshots with DB:", err);
  }
}

function initializeDatabase() {
  let d: any;
  let corrupted = false;
  const dbExistsBefore = fs.existsSync(DB_PATH);

  const deleteDatabaseFiles = () => {
    try {
      if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
      if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
      if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
    } catch (e) {
      console.error("Failed to delete corrupt database files:", e);
    }
  };

  const openAndCheck = (filePath: string) => {
    const conn = new Database(filePath);
    conn.pragma('journal_mode = DELETE');
    const integrity = conn.pragma('integrity_check') as any;
    if (integrity && integrity[0] && integrity[0].integrity_check !== 'ok') {
      throw new Error(`Integrity check failed: ${JSON.stringify(integrity)}`);
    }
    return conn;
  };

  try {
    d = openAndCheck(DB_PATH);
  } catch (err) {
    console.warn("Database file is corrupt or unreadable. Attempting recovery...", err);
    corrupted = true;
    deleteDatabaseFiles();
    d = new Database(DB_PATH);
    d.pragma('journal_mode = DELETE');
  }

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT,
      domain TEXT,
      scale TEXT,
      description TEXT,
      tags TEXT,
      content TEXT,
      permalink TEXT,
      stage TEXT,
      relevance INTEGER,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      sub_idx INTEGER,
      file_path TEXT,
      pinned INTEGER DEFAULT 0,
      is_new INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT,
      weight INTEGER DEFAULT 1,
      evidence TEXT,
      UNIQUE(source, target, type)
    );

    CREATE TABLE IF NOT EXISTS pending_relationships (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      weight INTEGER DEFAULT 1,
      evidence TEXT,
      status TEXT DEFAULT 'pending',
      UNIQUE(source, target, type)
    );

    CREATE TABLE IF NOT EXISTS sub_clusters (
      domain TEXT NOT NULL,
      sub_idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY(domain, sub_idx)
    );

    CREATE TABLE IF NOT EXISTS snapshots_v2 (
      filename TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      entity_count INTEGER DEFAULT 0,
      relationship_count INTEGER DEFAULT 0,
      pending_count INTEGER DEFAULT 0,
      size_bytes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS deleted_entities (
      id TEXT PRIMARY KEY,
      file_path TEXT,
      relative_path TEXT,
      filename TEXT,
      title TEXT,
      deleted_at TEXT
    );
  `;

  try {
    d.exec(schemaSql);
  } catch (err: any) {
    console.error("Database schema execution failed during startup:", err);
    try { d.close(); } catch {}
    deleteDatabaseFiles();
    d = new Database(DB_PATH);
    d.pragma('journal_mode = DELETE');
    d.exec(schemaSql);
    corrupted = true;
  }

  // Ensure sub_clusters has x, y, angle columns
  try {
    d.exec("ALTER TABLE sub_clusters ADD COLUMN x REAL");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE sub_clusters ADD COLUMN y REAL");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE sub_clusters ADD COLUMN angle REAL");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE sub_clusters ADD COLUMN parent_sub_idx INTEGER DEFAULT NULL");
  } catch (e) {}

  // Ensure entities has sub_idx column
  try {
    d.exec("ALTER TABLE entities ADD COLUMN sub_idx INTEGER");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE entities ADD COLUMN file_path TEXT");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE entities ADD COLUMN pinned INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE entities ADD COLUMN is_new INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE relationships ADD COLUMN visible INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    d.exec("ALTER TABLE pending_relationships ADD COLUMN visible INTEGER DEFAULT 0");
  } catch (e) {}

  // One-time migration: Clear existing green circles for all currently existing nodes
  try {
    d.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)");
    const migrated = d.prepare("SELECT version FROM schema_migrations WHERE version = 'clear_existing_circles'").get();
    if (!migrated) {
      console.log("Running one-time migration: clearing green circles for existing nodes...");
      d.exec("UPDATE entities SET is_new = 0");
      
      const allEnts = d.prepare("SELECT id, tags, stage FROM entities").all() as any[];
      const updateStmt = d.prepare("UPDATE entities SET tags = ?, stage = ? WHERE id = ?");
      for (const ent of allEnts) {
        let changed = false;
        let stage = ent.stage || '';
        if (stage === '🕳') {
          stage = '';
          changed = true;
        }
        let tags: string[] = [];
        try { tags = typeof ent.tags === 'string' ? JSON.parse(ent.tags) : (ent.tags || []); } catch {}
        if (tags.some((t: string) => t === '🕳' || t === '#🕳')) {
          tags = tags.filter((t: string) => t !== '🕳' && t !== '#🕳');
          changed = true;
        }
        if (changed) {
          updateStmt.run(JSON.stringify(tags), stage, ent.id);
        }
      }
      d.prepare("INSERT INTO schema_migrations (version) VALUES ('clear_existing_circles')").run();
      console.log("One-time migration completed: all existing green circles cleared.");
    }
  } catch (err) {
    console.error("Error during one-time green circle cleanup migration:", err);
  }

  // Sync disk snapshots with database
  syncDiskSnapshotsToDb(d);

  // Auto-restore latest snapshot if any snapshots exist
  try {
    const latestSnapshotRow = d.prepare('SELECT filename, data, timestamp FROM snapshots_v2 ORDER BY timestamp DESC LIMIT 1').get() as any;
    if (latestSnapshotRow && latestSnapshotRow.data) {
      console.log(`[Database Startup] Found latest snapshot '${latestSnapshotRow.filename}' (${latestSnapshotRow.timestamp}). Restoring latest snapshot on startup...`);
      const snapData = JSON.parse(latestSnapshotRow.data);
      
      d.exec('BEGIN TRANSACTION');
      try {
        d.exec('DELETE FROM entities');
        d.exec('DELETE FROM relationships');
        d.exec('DELETE FROM pending_relationships');
        d.exec('DELETE FROM sub_clusters');

        if (Array.isArray(snapData.entities)) {
          const stmt = d.prepare(`
            INSERT INTO entities (id, title, type, domain, scale, description, tags, content, permalink, stage, relevance, x, y, sub_idx, file_path, pinned)
            VALUES (@id, @title, @type, @domain, @scale, @description, @tags, @content, @permalink, @stage, @relevance, @x, @y, @sub_idx, @file_path, @pinned)
          `);
          for (const item of snapData.entities) {
            stmt.run({
              id: item.id,
              title: item.title || 'Untitled',
              type: item.type || 'note',
              domain: item.domain || 'uncategorized',
              scale: item.scale || 'street',
              description: item.description || '',
              tags: typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags || []),
              content: item.content || '',
              permalink: item.permalink || '',
              stage: item.stage || '',
              relevance: item.relevance || 0,
              x: item.x || 0,
              y: item.y || 0,
              sub_idx: item.sub_idx !== undefined ? item.sub_idx : null,
              file_path: item.file_path !== undefined ? item.file_path : null,
              pinned: item.pinned !== undefined ? item.pinned : 0
            });
          }
        }

        if (Array.isArray(snapData.relationships)) {
          const stmt = d.prepare(`
            INSERT INTO relationships (id, source, target, type, weight, evidence, visible)
            VALUES (@id, @source, @target, @type, @weight, @evidence, @visible)
          `);
          for (const item of snapData.relationships) {
            stmt.run({
              id: item.id,
              source: item.source,
              target: item.target,
              type: item.type || 'references',
              weight: item.weight || 1,
              evidence: item.evidence || '',
              visible: item.visible ? 1 : 0
            });
          }
        }

        if (Array.isArray(snapData.pending_relationships)) {
          const stmt = d.prepare(`
            INSERT INTO pending_relationships (id, source, target, type, weight, evidence, status, visible)
            VALUES (@id, @source, @target, @type, @weight, @evidence, @status, @visible)
          `);
          for (const item of snapData.pending_relationships) {
            stmt.run({
              id: item.id,
              source: item.source,
              target: item.target,
              type: item.type,
              weight: item.weight || 1,
              evidence: item.evidence || '',
              status: item.status || 'pending',
              visible: item.visible ? 1 : 0
            });
          }
        }

        if (Array.isArray(snapData.sub_clusters)) {
          const stmt = d.prepare(`
            INSERT INTO sub_clusters (domain, sub_idx, title, x, y, angle, parent_sub_idx)
            VALUES (@domain, @sub_idx, @title, @x, @y, @angle, @parent_sub_idx)
          `);
          for (const item of snapData.sub_clusters) {
            stmt.run({
              domain: item.domain,
              sub_idx: item.sub_idx,
              title: item.title,
              x: item.x !== undefined ? item.x : null,
              y: item.y !== undefined ? item.y : null,
              angle: item.angle !== undefined ? item.angle : null,
              parent_sub_idx: item.parent_sub_idx !== undefined ? item.parent_sub_idx : null
            });
          }
        }

        d.exec('COMMIT');
        console.log(`[Database Startup] Successfully restored latest snapshot '${latestSnapshotRow.filename}' with ${snapData.entities ? snapData.entities.length : 0} entities.`);
      } catch (err) {
        d.exec('ROLLBACK');
        console.error("[Database Startup] Failed to restore latest snapshot on startup:", err);
      }
    } else {
      let shouldRestore = corrupted;
      if (!dbExistsBefore) {
        shouldRestore = true;
      } else {
        try {
          const countRow = d.prepare("SELECT COUNT(*) as count FROM entities").get() as any;
          if (!countRow || countRow.count === 0) {
            shouldRestore = true;
          }
        } catch (e) {
          shouldRestore = true;
        }
      }

      if (shouldRestore) {
        if (fs.existsSync(JSON_BACKUP_PATH)) {
          console.log("Database empty or missing. Restoring from JSON backup on startup...");
          restoreDatabaseFromBackup(d);
        } else if (fs.existsSync(BINARY_BACKUP_PATH)) {
          console.log("Database empty or missing. Restoring from binary backup on startup...");
          try {
            d.close();
            fs.copyFileSync(BINARY_BACKUP_PATH, DB_PATH);
            d = openAndCheck(DB_PATH);
            console.log("Database restored from binary backup successfully on startup!");
          } catch (err) {
            console.error("Binary backup restore on startup failed:", err);
            try {
              d = openAndCheck(DB_PATH);
            } catch (reopenErr) {
              d = new Database(DB_PATH);
              d.pragma('journal_mode = DELETE');
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[Database Startup] Error checking snapshots for auto-restore:", err);
  }

  try {
    const allSnaps = d.prepare('SELECT filename, data FROM snapshots_v2').all() as any[];
    const updateStmt = d.prepare('UPDATE snapshots_v2 SET pending_count = ? WHERE filename = ?');
    for (const snap of allSnaps) {
      try {
        const parsed = JSON.parse(snap.data);
        if (Array.isArray(parsed.pending_relationships)) {
          const truePendingCount = parsed.pending_relationships.filter((p: any) => p.status === 'pending').length;
          updateStmt.run(truePendingCount, snap.filename);
        }
      } catch {}
    }
  } catch (e) {}

  return d;
}

export function normalizeDomain(rawDomain: string): string {
  const d = (rawDomain || '').trim().toLowerCase();
  if (d === 'metacrisis' || d === 'sensemaking' || d === 'knowledgemanagement' || d === 'athlete') return 'uncategorized';
  if (d === 'uncategorized' || d === '') return 'uncategorized';
  if (d === 'research' || d === 'log') return 'research';
  if (d === 'design') return 'design';
  if (d === 'lab') return 'lab';
  if (d === 'alchemy') return 'alchemy';
  if (d === 'art') return 'art';
  if (d === 'regen') return 'regen';
  if (d === 'host') return 'host';
  if (d === 'music') return 'music';
  if (d === 'player') return 'player';
  if (d === 'l1f3') return 'L1F3';
  if (d === 'ai') return 'AI';
  return 'uncategorized';
}

export const db = initializeDatabase();

try {
  // Cleanup removed
  // Update removed
} catch (e) {
  console.error("Failed to run startup cleanup of unwanted domains:", e);
}

const DEFAULT_SUB_CLUSTERS: Record<string, string[]> = {
  sensemaking: [
    "sensemaking methodologies",
    "epistemology"
  ],
  knowledgemanagement: [
    "PKM",
    "tools"
  ],
  athlete: [
    "training",
    "nutrition"
  ],
  metacrisis: [
    "technological responses to the metacrisis",
    "metacrisis",
    "sensemaking",
    "knowledgemanagement"
  ],
  uncategorized: [
    "Raw Ingests & Transient Thoughts",
    "Unmapped Ground & Emerging Signals",
    "Miscellaneous Connections",
    "Orphan Nodes & Loose Ends"
  ],
  research: [
    "Epistemic Tooling & Digital Archiving",
    "Decentralized Science & Semantic Web",
    "Collective Intelligence Systems",
    "Systems Thinking & Cybernetics",
    "Cybernetic Governance & Local Org",
    "Complexity Science & Network Dynamics",
    "Meta-Cognitive Protocol Engineering",
    "Interactive Cartography & Atlas Systems"
  ],
  design: [
    "Speculative Interfaces & Spatial Media",
    "Information Aesthetics & Metaphors",
    "Participatory Design & Co-Creation",
    "Experience Architecture"
  ],
  lab: [
    "Experimental Prototypes & Sandbox",
    "Protocol Engineering & Decentralized Tech",
    "Physical Computing & IoT Fabrications",
    "Next-Gen Compiler Experiments"
  ],
  alchemy: [
    "Esoteric Traditions & Hermetic Studies",
    "Psychedelic Science & Cognitive Exploration",
    "Symbolic Systems & Archetypal Patterns",
    "Transmutation & Ritual Spaces"
  ],
  art: [
    "Generative Systems & Algorithmic Art",
    "Immersive Installations & New Media",
    "Conceptual Interventions & Performance",
    "Curation & Digital Archives"
  ],
  host: [
    "Communal Living & Collaborative Residencies",
    "Event Production & Cultural Protocols",
    "Digital Infrastructure for Decentralized Hubs",
    "Community Governance & Steward Circles"
  ],
  regen: [
    "Bioregional Development & Local Currencies",
    "Regenerative Finance & Green Bonds",
    "Mutual Aid & Digital Commons",
    "Ecological Engineering & Conservation"
  ],
  music: [
    "Interactive Synthesis & Audio DSP",
    "Modular Synths & Live Performance",
    "Generative Acoustics & Music AI",
    "Sonic Cartography & Acoustemology"
  ],
  player: [
    "Meta-Gaming & Economic Mechanics",
    "Ludic Spaces & Virtual Ecologies",
    "Interactive Narrative Design",
    "Procedural Worldbuilding"
  ],
  L1F3: [
    "Biometric Self-Tracking & Longevity",
    "Somatic Practices & Yoga Engineering",
    "Life Operations & Flow States",
    "Habit Stacking & Behavioral Loops"
  ],
  AI: [
    "Neural Models & Generative Agents",
    "Cognitive Architectures & Vector RAG",
    "Human-AI Interface Symbiosis",
    "AI Safety & Interpretability"
  ]
};

try {
  const insertSub = db.prepare(`
    INSERT OR IGNORE INTO sub_clusters (domain, sub_idx, title) VALUES (?, ?, ?)
  `);
  for (const [domain, titles] of Object.entries(DEFAULT_SUB_CLUSTERS)) {
    // Seed predefined titles
    titles.forEach((title, sub_idx) => {
      insertSub.run(domain, sub_idx, title);
    });
  }
  console.log("Verified and seeded predefined sub_clusters successfully!");
} catch (e) {
  console.error("Error seeding sub_clusters table:", e);
}

export function clearDatabase() {
  db.exec('DELETE FROM relationships');
  db.exec('DELETE FROM entities');
  db.exec('DELETE FROM pending_relationships');
  Promise.resolve().then(() => backupDatabase());
}

export function determineTypeFromTags(tags: string[], existingType?: string): string {
  const normalized = (tags || []).map(t => t.replace(/^#/, '').toLowerCase().trim());
  
  if (normalized.some(t => ['person', 'organization', 'community', 'network'].includes(t))) return 'actors';
  if (normalized.some(t => ['project', 'tool', 'prototype', 'experiment'].includes(t))) return 'projects';
  if (normalized.some(t => ['concept', 'framework', 'pattern', 'topic'].includes(t))) return 'knowledge';
  if (normalized.some(t => ['article', 'book', 'paper', 'podcast', 'video', 'website'].includes(t))) return 'sources';
  if (normalized.some(t => ['c4ss1us', 'l1f3'].includes(t))) return 'original';

  if (existingType && existingType !== 'note') {
    return existingType;
  }
  return 'note';
}

export function insertEntity(entity: any) {
  let existing: any = null;
  try {
    existing = db.prepare('SELECT x, y, domain, sub_idx, file_path, pinned, is_new FROM entities WHERE id = ?').get(entity.id) as any;
    if (!existing && entity.file_path) {
      existing = db.prepare('SELECT x, y, domain, sub_idx, file_path, pinned, is_new FROM entities WHERE file_path = ?').get(entity.file_path) as any;
    }
    if (!existing && entity.title) {
      existing = db.prepare('SELECT x, y, domain, sub_idx, file_path, pinned, is_new FROM entities WHERE title = ?').get(entity.title) as any;
    }
  } catch {}

  let domain = normalizeDomain(entity.domain);
  let x = entity.x !== undefined ? entity.x : 0;
  let y = entity.y !== undefined ? entity.y : 0;
  let sub_idx = entity.sub_idx !== undefined ? entity.sub_idx : null;
  let file_path = entity.file_path !== undefined ? entity.file_path : null;
  let pinned = entity.pinned !== undefined ? entity.pinned : 0;
  let is_new = entity.is_new !== undefined ? (entity.is_new ? 1 : 0) : (existing ? (existing.is_new ?? 0) : 1);

  if (existing) {
    // STRICTLY PRESERVE existing DB domain, sub_idx, x, y, pinned
    if (existing.domain) {
      domain = normalizeDomain(existing.domain);
    }
    if (existing.sub_idx !== undefined && existing.sub_idx !== null) {
      sub_idx = existing.sub_idx;
    }
    if (existing.x !== undefined && existing.x !== null && (x === 0 && y === 0)) {
      x = existing.x;
      y = existing.y || 0;
    }
    if (existing.pinned !== undefined && existing.pinned !== null) {
      pinned = existing.pinned;
    }
    if (!file_path && existing.file_path) {
      file_path = existing.file_path;
    }
  }

  const rawTags = entity.tags || [];
  const tags = rawTags.map((t: string) => t === 'log' ? 'research' : t);
  const resolvedType = determineTypeFromTags(tags, entity.type || 'note');

  const stmt = db.prepare(`
    INSERT INTO entities (id, title, type, domain, scale, description, tags, content, permalink, stage, relevance, x, y, sub_idx, file_path, pinned, is_new)
    VALUES (@id, @title, @type, @domain, @scale, @description, @tags, @content, @permalink, @stage, @relevance, @x, @y, @sub_idx, @file_path, @pinned, @is_new)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      domain = excluded.domain,
      scale = excluded.scale,
      description = excluded.description,
      tags = excluded.tags,
      content = excluded.content,
      permalink = excluded.permalink,
      stage = excluded.stage,
      relevance = excluded.relevance,
      x = excluded.x,
      y = excluded.y,
      sub_idx = excluded.sub_idx,
      file_path = excluded.file_path,
      pinned = excluded.pinned,
      is_new = excluded.is_new
  `);

  stmt.run({
    id: entity.id,
    title: entity.title || 'Untitled',
    type: resolvedType,
    domain: domain,
    scale: entity.scale || 'street',
    description: entity.description || '',
    tags: JSON.stringify(tags),
    content: entity.content || '',
    permalink: entity.permalink || '',
    stage: entity.stage || '',
    relevance: entity.relevance || 0,
    x,
    y,
    sub_idx,
    file_path,
    pinned,
    is_new
  });
  
  Promise.resolve().then(() => backupDatabase());
}

export function updateEntityCoordinates(id: string, x: number, y: number, domain?: string) {
  if (domain) {
    db.prepare('UPDATE entities SET x = ?, y = ?, domain = ?, pinned = 1 WHERE id = ?').run(x, y, domain, id);
  } else {
    db.prepare('UPDATE entities SET x = ?, y = ?, pinned = 1 WHERE id = ?').run(x, y, id);
  }
  Promise.resolve().then(() => backupDatabase());
}

export function updateEntitiesCoordinatesBatch(updates: Array<{ id: string, x: number, y: number, domain?: string }>) {
  const transaction = db.transaction((items) => {
    const stmtDomain = db.prepare('UPDATE entities SET x = ?, y = ?, domain = ?, pinned = 1 WHERE id = ?');
    const stmtNormal = db.prepare('UPDATE entities SET x = ?, y = ?, pinned = 1 WHERE id = ?');
    for (const item of items) {
      if (item.domain) {
        stmtDomain.run(item.x, item.y, item.domain, item.id);
      } else {
        stmtNormal.run(item.x, item.y, item.id);
      }
    }
  });
  transaction(updates);
  Promise.resolve().then(() => backupDatabase());
}

export function getSubClusters() {
  return db.prepare("SELECT * FROM sub_clusters ").all();
}

export function updateSubClusterTitle(domain: string, sub_idx: number, title: string) {
  db.prepare(`
    INSERT INTO sub_clusters (domain, sub_idx, title)
    VALUES (?, ?, ?)
    ON CONFLICT(domain, sub_idx) DO UPDATE SET title = excluded.title
  `).run(domain, sub_idx, title);
  Promise.resolve().then(() => backupDatabase());
}

export function updateSubClusterGeometry(domain: string, sub_idx: number, title: string, x: number | null, y: number | null, angle: number | null) {
  db.prepare(`
    INSERT INTO sub_clusters (domain, sub_idx, title, x, y, angle)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain, sub_idx) DO UPDATE SET
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE sub_clusters.title END,
      x = excluded.x,
      y = excluded.y,
      angle = excluded.angle
  `).run(domain, sub_idx, title, x, y, angle);
  Promise.resolve().then(() => backupDatabase());
}

export function createSubCluster(domain: string, parent_sub_idx: number | null, title: string) {
  const row = db.prepare('SELECT MAX(sub_idx) as max_idx FROM sub_clusters WHERE domain = ?').get(domain) as any;
  const nextIdx = (row && row.max_idx !== null) ? Number(row.max_idx) + 1 : 0;

  db.prepare(`
    INSERT INTO sub_clusters (domain, sub_idx, title, parent_sub_idx)
    VALUES (?, ?, ?, ?)
  `).run(domain, nextIdx, title, parent_sub_idx);

  Promise.resolve().then(() => backupDatabase());
  return nextIdx;
}

export function deleteSubCluster(domain: string, targetSubIdx: number) {
  const transaction = db.transaction(() => {
    const target = db.prepare('SELECT * FROM sub_clusters WHERE domain = ? AND sub_idx = ?').get(domain, targetSubIdx) as any;
    const isTopLevel = !target || target.parent_sub_idx === null || target.parent_sub_idx === undefined;

    if (!isTopLevel) {
      db.prepare('DELETE FROM sub_clusters WHERE domain = ? AND sub_idx = ?').run(domain, targetSubIdx);
      return;
    }

    // Top-level sub-cluster deletion:
    // Delete sub-sub-clusters belonging to this top-level sub-cluster
    db.prepare('DELETE FROM sub_clusters WHERE domain = ? AND parent_sub_idx = ?').run(domain, targetSubIdx);

    // Delete the sub-cluster itself
    db.prepare('DELETE FROM sub_clusters WHERE domain = ? AND sub_idx = ?').run(domain, targetSubIdx);

    // Unassign entities in target sub-cluster
    db.prepare('UPDATE entities SET sub_idx = NULL WHERE domain = ? AND sub_idx = ?').run(domain, targetSubIdx);

    // Decrement sub_idx of entities with sub_idx > targetSubIdx
    db.prepare('UPDATE entities SET sub_idx = sub_idx - 1 WHERE domain = ? AND sub_idx > ?').run(domain, targetSubIdx);

    // Decrement parent_sub_idx of child sub-sub-clusters whose parent was > targetSubIdx
    db.prepare('UPDATE sub_clusters SET parent_sub_idx = parent_sub_idx - 1 WHERE domain = ? AND parent_sub_idx > ?').run(domain, targetSubIdx);

    // Get remaining sub-clusters in this domain with sub_idx > targetSubIdx ordered by sub_idx ASC
    const subsToShift = db.prepare('SELECT * FROM sub_clusters WHERE domain = ? AND sub_idx > ? ORDER BY sub_idx ASC').all(domain, targetSubIdx) as any[];

    for (const sc of subsToShift) {
      db.prepare('DELETE FROM sub_clusters WHERE domain = ? AND sub_idx = ?').run(domain, sc.sub_idx);
    }

    for (const sc of subsToShift) {
      const newIdx = sc.sub_idx - 1;
      let newTitle = sc.title;
      if (/^SEC-0?\d+$/i.test(sc.title)) {
        newTitle = `SEC-0${newIdx + 1}`;
      }
      db.prepare(`
        INSERT INTO sub_clusters (domain, sub_idx, title, x, y, angle, parent_sub_idx)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(domain, newIdx, newTitle, sc.x ?? null, sc.y ?? null, sc.angle ?? null, sc.parent_sub_idx ?? null);
    }
  });

  transaction();
  Promise.resolve().then(() => backupDatabase());
}

export function renameCluster(oldDomain: string, newDomain: string) {
  db.prepare('UPDATE entities SET domain = ? WHERE domain = ?').run(newDomain, oldDomain);
  db.prepare('UPDATE sub_clusters SET domain = ? WHERE domain = ?').run(newDomain, oldDomain);
  Promise.resolve().then(() => backupDatabase());
}

export function createCluster(domain: string) {
  db.prepare(`
    INSERT OR IGNORE INTO sub_clusters (domain, sub_idx, title)
    VALUES (?, 0, 'SEC-01')
  `).run(domain);
  Promise.resolve().then(() => backupDatabase());
}

export function updateEntityDomain(id: string, domain: string, x?: number, y?: number) {
  if (x !== undefined && y !== undefined) {
    db.prepare('UPDATE entities SET domain = ?, x = ?, y = ?, pinned = 1 WHERE id = ?').run(domain, x, y, id);
  } else {
    db.prepare('UPDATE entities SET domain = ?, x = 0, y = 0, pinned = 0 WHERE id = ?').run(domain, id);
  }
  Promise.resolve().then(() => backupDatabase());
}

export function updateEntitySubCluster(id: string, sub_idx: number | null, x?: number, y?: number) {
  if (x !== undefined && y !== undefined) {
    db.prepare('UPDATE entities SET sub_idx = ?, x = ?, y = ?, pinned = 1 WHERE id = ?').run(sub_idx, x, y, id);
  } else {
    db.prepare('UPDATE entities SET sub_idx = ?, x = 0, y = 0, pinned = 0 WHERE id = ?').run(sub_idx, id);
  }
  Promise.resolve().then(() => backupDatabase());
}

export function insertRelationship(rel: any) {
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO relationships (id, source, target, type, weight, evidence, visible)
      VALUES (@id, @source, @target, @type, @weight, @evidence, @visible)
    `);
    stmt.run({
      id: rel.id,
      source: rel.source,
      target: rel.target,
      type: rel.type || 'references',
      weight: rel.weight || 1,
      evidence: rel.evidence || '',
      visible: rel.visible ? 1 : 0
    });
    Promise.resolve().then(() => backupDatabase());
  } catch (e) {
    console.error("Error inserting relationship:", e);
  }
}

export function getEntities() {
  const rows = db.prepare('SELECT * FROM entities').all();
  return rows.map((r: any) => {
    const domain = normalizeDomain(r.domain);
    const rawTags = JSON.parse(r.tags || '[]');
    const tags = rawTags.map((t: string) => t === 'log' ? 'research' : t);
    const resolvedType = determineTypeFromTags(tags, r.type || 'note');
    return {
      ...r,
      domain,
      tags,
      type: resolvedType,
      sub_idx: r.sub_idx !== null && r.sub_idx !== undefined ? Number(r.sub_idx) : null
    };
  });
}

export function getRelationships() {
  const rows = db.prepare('SELECT * FROM relationships').all();
  return (rows || []).filter(Boolean).map((r: any) => ({
    ...r,
    visible: Boolean(r && r.visible)
  }));
}

export function getPendingRelationships() {
  const rows = db.prepare(`
    SELECT pr.*, 
           COALESCE(e1.title, 'Unknown Source') AS source_title, 
           COALESCE(e2.title, 'Unknown Target') AS target_title
    FROM pending_relationships pr
    LEFT JOIN entities e1 ON pr.source = e1.id
    LEFT JOIN entities e2 ON pr.target = e2.id
  `).all();
  return rows;
}

export function insertPendingRelationship(rel: any) {
  try {
    const visibleInt = rel.visible ? 1 : 0;
    // 1. Insert into pending_relationships with status 'pending' (pending review)
    const stmtPending = db.prepare(`
      INSERT OR REPLACE INTO pending_relationships (id, source, target, type, weight, evidence, status, visible)
      VALUES (@id, @source, @target, @type, @weight, @evidence, 'pending', @visible)
    `);
    stmtPending.run({
      id: rel.id,
      source: rel.source,
      target: rel.target,
      type: rel.type,
      weight: rel.weight || 1,
      evidence: rel.evidence || '',
      visible: visibleInt
    });

    // 2. Also insert directly into active relationships so they appear on the graph immediately
    const stmtRel = db.prepare(`
      INSERT OR REPLACE INTO relationships (id, source, target, type, weight, evidence, visible)
      VALUES (@id, @source, @target, @type, @weight, @evidence, @visible)
    `);
    stmtRel.run({
      id: rel.id,
      source: rel.source,
      target: rel.target,
      type: rel.type,
      weight: rel.weight || 1,
      evidence: rel.evidence || '',
      visible: visibleInt
    });

    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
  } catch (e) {
    console.error("Error inserting pending relationship:", e);
  }
}

export function approvePendingRelationship(id: string, customType?: string) {
  try {
    // 1. Fetch pending info
    const pending = db.prepare('SELECT * FROM pending_relationships WHERE id = ?').get(id) as any;
    if (!pending) return false;

    const finalType = customType || pending.type;

    // 2. Insert or replace in main relationships
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO relationships (id, source, target, type, weight, evidence, visible)
      VALUES (@id, @source, @target, @type, @weight, @evidence, @visible)
    `);
    stmt.run({
      id: pending.id,
      source: pending.source,
      target: pending.target,
      type: finalType,
      weight: pending.weight,
      evidence: pending.evidence,
      visible: pending.visible !== undefined ? pending.visible : 1
    });

    // 3. Mark approved in pending and save finalType and visible = 1
    db.prepare("UPDATE pending_relationships SET status = 'approved', type = ?, visible = 1 WHERE id = ?").run(finalType, id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (e) {
    console.error("Error approving relationship:", e);
    return false;
  }
}

export function updatePendingRelationshipType(id: string, type: string) {
  try {
    const resPending = db.prepare("UPDATE pending_relationships SET type = ? WHERE id = ?").run(type, id);
    const resActive = db.prepare("UPDATE relationships SET type = ? WHERE id = ?").run(type, id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return resPending.changes > 0 || resActive.changes > 0;
  } catch (e) {
    console.error("Error updating relationship type:", e);
    return false;
  }
}

export function rejectPendingRelationship(id: string) {
  try {
    db.prepare("UPDATE pending_relationships SET status = 'rejected' WHERE id = ?").run(id);
    // Also make sure to remove it from main relationships if it was approved previously
    db.prepare("DELETE FROM relationships WHERE id = ?").run(id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (e) {
    console.error("Error rejecting relationship:", e);
    return false;
  }
}

export function clearPendingRelationships() {
  db.exec("DELETE FROM pending_relationships");
  try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
  Promise.resolve().then(() => backupDatabase());
}

export function deleteAutoRelationshipsForEntity(sourceId: string) {
  try {
    db.prepare("DELETE FROM relationships WHERE source = ? AND type = 'references'").run(sourceId);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
  } catch (err) {
    console.error("Error deleting automatic references for source ID:", sourceId, err);
  }
}

export function deleteRelationship(id: string) {
  try {
    db.prepare("DELETE FROM relationships WHERE id = ?").run(id);
    db.prepare("DELETE FROM pending_relationships WHERE id = ?").run(id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (e) {
    console.error("Error deleting relationship:", e);
    return false;
  }
}

export function createManualRelationship(source: string, target: string, type: string, evidence?: string, visible: boolean = true) {
  const id = `manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const visibleInt = visible ? 1 : 0;
  try {
    // Clean up any existing relationship between source and target (both directions) to prevent duplicate links
    db.prepare("DELETE FROM relationships WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)").run(source, target, target, source);
    db.prepare("DELETE FROM pending_relationships WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)").run(source, target, target, source);

    db.prepare(`
      INSERT INTO relationships (id, source, target, type, weight, evidence, visible)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, source, target, type, evidence || 'Manually created connection', visibleInt);
    
    // Also add to pending_relationships as 'approved' so it displays correctly in tables
    db.prepare(`
      INSERT INTO pending_relationships (id, source, target, type, weight, evidence, status, visible)
      VALUES (?, ?, ?, ?, 1, ?, 'approved', ?)
    `).run(id, source, target, type, evidence || 'Manually created connection', visibleInt);
    
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return id;
  } catch (e) {
    console.error("Error creating manual relationship:", e);
    return null;
  }
}

export function updateRelationshipDetails(id: string, type: string, evidence?: string, visible: boolean = true) {
  const visibleInt = visible ? 1 : 0;
  try {
    db.prepare(`
      UPDATE relationships SET type = ?, evidence = ?, visible = ? WHERE id = ?
    `).run(type, evidence || '', visibleInt, id);
    db.prepare(`
      UPDATE pending_relationships SET type = ?, evidence = ?, visible = ? WHERE id = ?
    `).run(type, evidence || '', visibleInt, id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (e) {
    console.error("Error updating relationship details:", e);
    return false;
  }
}

export function updateRelationshipVisibility(id: string, visible: boolean) {
  try {
    const visibleInt = visible ? 1 : 0;
    db.prepare("UPDATE relationships SET visible = ? WHERE id = ?").run(visibleInt, id);
    db.prepare("UPDATE pending_relationships SET visible = ? WHERE id = ?").run(visibleInt, id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (e) {
    console.error("Error updating relationship visibility:", e);
    return false;
  }
}

export function getSnapshotsList() {
  syncDiskSnapshotsToDb();
  try {
    const list = db.prepare('SELECT filename, timestamp, name, entity_count, relationship_count, pending_count, size_bytes FROM snapshots_v2 ORDER BY timestamp DESC').all() as any[];
    return list.map(item => ({
      filename: item.filename,
      timestamp: item.timestamp,
      name: item.name,
      entityCount: item.entity_count,
      relationshipCount: item.relationship_count,
      pendingCount: item.pending_count,
      sizeBytes: item.size_bytes
    }));
  } catch (err) {
    console.error("Failed to list snapshots from DB:", err);
    return [];
  }
}

export function getSnapshotData(filename: string): string | null {
  try {
    const row = db.prepare('SELECT data FROM snapshots_v2 WHERE filename = ?').get(filename) as any;
    return row ? row.data : null;
  } catch (err) {
    console.error("Failed to fetch snapshot data from DB:", err);
    return null;
  }
}

export function createDbSnapshot(label: string) {
  try {
    const snapshotData = {
      timestamp: new Date().toISOString(),
      name: label || `Snapshot ${new Date().toLocaleString()}`,
      entities: db.prepare('SELECT * FROM entities').all(),
      relationships: db.prepare('SELECT * FROM relationships').all(),
      pending_relationships: db.prepare('SELECT * FROM pending_relationships').all(),
      sub_clusters: db.prepare('SELECT * FROM sub_clusters').all()
    };
    
    const safeLabel = (label || 'snapshot')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 30);
    const filename = `snapshot_${Date.now()}_${safeLabel}.json`;
    
    const rawData = JSON.stringify(snapshotData, null, 2);
    const sizeBytes = Buffer.byteLength(rawData, 'utf-8');
    
    const pendingCount = snapshotData.pending_relationships.filter((p: any) => p.status === 'pending').length;
    
    db.prepare(`
      INSERT INTO snapshots_v2 (filename, timestamp, name, data, entity_count, relationship_count, pending_count, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      filename,
      snapshotData.timestamp,
      snapshotData.name,
      rawData,
      snapshotData.entities.length,
      snapshotData.relationships.length,
      pendingCount,
      sizeBytes
    );
    
    saveSnapshotToDiskFolders(filename, rawData);
    console.log(`Created custom snapshot in database and persistent disk folders: ${filename}`);
    
    // Checkpoint WAL immediately to ensure snapshot is in atlas.db
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {}

    // Force an immediate synchronous backup to ensure it survives container restart
    try {
      const liveData: any = {
        entities: db.prepare('SELECT * FROM entities').all(),
        relationships: db.prepare('SELECT * FROM relationships').all(),
        pending_relationships: db.prepare('SELECT * FROM pending_relationships').all(),
        sub_clusters: db.prepare('SELECT * FROM sub_clusters').all()
      };
      try { liveData.snapshots_v2 = db.prepare('SELECT * FROM snapshots_v2').all(); } catch(e) {}
      
      const liveContent = JSON.stringify(liveData, null, 2);
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const tempLivePath = JSON_BACKUP_PATH + '.tmp.live';
      fs.writeFileSync(tempLivePath, liveContent, 'utf-8');
      fs.renameSync(tempLivePath, JSON_BACKUP_PATH);

      try {
        const tempSecLive = SECONDARY_JSON_BACKUP_PATH + '.tmp.live';
        fs.writeFileSync(tempSecLive, liveContent, 'utf-8');
        fs.renameSync(tempSecLive, SECONDARY_JSON_BACKUP_PATH);
      } catch (e) {}
      
      if (fs.existsSync(DB_PATH)) {
        const tempBinaryPath = BINARY_BACKUP_PATH + '.tmp';
        fs.copyFileSync(DB_PATH, tempBinaryPath);
        fs.renameSync(tempBinaryPath, BINARY_BACKUP_PATH);
      }
    } catch (backupErr) {
      console.error("Failed synchronous backup after snapshot creation:", backupErr);
    }
    
    return { success: true, filename };
  } catch (err) {
    console.error("Failed to create snapshot in DB:", err);
    throw err;
  }
}

export function restoreDbSnapshot(filename: string) {
  try {
    const row = db.prepare('SELECT data FROM snapshots_v2 WHERE filename = ?').get(filename) as any;
    if (!row) {
      throw new Error("Snapshot not found in database.");
    }
    const data = JSON.parse(row.data);
    
    db.exec('BEGIN TRANSACTION');
    try {
      db.exec('DELETE FROM entities');
      db.exec('DELETE FROM relationships');
      db.exec('DELETE FROM pending_relationships');
      db.exec('DELETE FROM sub_clusters');

      if (Array.isArray(data.entities)) {
        const stmt = db.prepare(`
          INSERT INTO entities (id, title, type, domain, scale, description, tags, content, permalink, stage, relevance, x, y, sub_idx, file_path, pinned)
          VALUES (@id, @title, @type, @domain, @scale, @description, @tags, @content, @permalink, @stage, @relevance, @x, @y, @sub_idx, @file_path, @pinned)
        `);
        for (const item of data.entities) {
          stmt.run({
            id: item.id,
            title: item.title || 'Untitled',
            type: item.type || 'note',
            domain: item.domain || 'uncategorized',
            scale: item.scale || 'street',
            description: item.description || '',
            tags: typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags || []),
            content: item.content || '',
            permalink: item.permalink || '',
            stage: item.stage || '',
            relevance: item.relevance || 0,
            x: item.x || 0,
            y: item.y || 0,
            sub_idx: item.sub_idx !== undefined ? item.sub_idx : null,
            file_path: item.file_path !== undefined ? item.file_path : null,
            pinned: item.pinned !== undefined ? item.pinned : 0
          });
        }
      }

      if (Array.isArray(data.relationships)) {
        const stmt = db.prepare(`
          INSERT INTO relationships (id, source, target, type, weight, evidence, visible)
          VALUES (@id, @source, @target, @type, @weight, @evidence, @visible)
        `);
        for (const item of data.relationships) {
          stmt.run({
            id: item.id,
            source: item.source,
            target: item.target,
            type: item.type || 'references',
            weight: item.weight || 1,
            evidence: item.evidence || '',
            visible: item.visible ? 1 : 0
          });
        }
      }

      if (Array.isArray(data.pending_relationships)) {
        const stmt = db.prepare(`
          INSERT INTO pending_relationships (id, source, target, type, weight, evidence, status, visible)
          VALUES (@id, @source, @target, @type, @weight, @evidence, @status, @visible)
        `);
        for (const item of data.pending_relationships) {
          stmt.run({
            id: item.id,
            source: item.source,
            target: item.target,
            type: item.type,
            weight: item.weight || 1,
            evidence: item.evidence || '',
            status: item.status || 'pending',
            visible: item.visible ? 1 : 0
          });
        }
      }

      if (Array.isArray(data.sub_clusters)) {
        const stmt = db.prepare(`
          INSERT INTO sub_clusters (domain, sub_idx, title, x, y, angle, parent_sub_idx)
          VALUES (@domain, @sub_idx, @title, @x, @y, @angle, @parent_sub_idx)
        `);
        for (const item of data.sub_clusters) {
          stmt.run({
            domain: item.domain,
            sub_idx: item.sub_idx,
            title: item.title,
            x: item.x !== undefined ? item.x : null,
            y: item.y !== undefined ? item.y : null,
            angle: item.angle !== undefined ? item.angle : null,
            parent_sub_idx: item.parent_sub_idx !== undefined ? item.parent_sub_idx : null
          });
        }
      }

      db.exec('COMMIT');
      console.log(`Database restored successfully from snapshot: ${filename}`);
      
      // Force immediate synchronous backup to backup_atlas.json and binary backup
      try {
        const liveData: any = {
          entities: db.prepare('SELECT * FROM entities').all(),
          relationships: db.prepare('SELECT * FROM relationships').all(),
          pending_relationships: db.prepare('SELECT * FROM pending_relationships').all(),
          sub_clusters: db.prepare('SELECT * FROM sub_clusters').all()
        };
        try {
          liveData.snapshots_v2 = db.prepare('SELECT * FROM snapshots_v2').all();
        } catch (e) {}
        const tempLivePath = JSON_BACKUP_PATH + '.tmp.live';
        fs.writeFileSync(tempLivePath, JSON.stringify(liveData, null, 2), 'utf-8');
        fs.renameSync(tempLivePath, JSON_BACKUP_PATH);
        console.log(`Synchronous JSON backup saved to ${JSON_BACKUP_PATH}`);
        
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (checkpointErr) {}
        
        if (fs.existsSync(DB_PATH)) {
          fs.copyFileSync(DB_PATH, BINARY_BACKUP_PATH);
          console.log(`Synchronous binary backup saved to ${BINARY_BACKUP_PATH}`);
        }
      } catch (backupErr) {
        console.error("Failed to perform synchronous post-restore backups:", backupErr);
      }
      return true;
    } catch (err) {
      db.exec('ROLLBACK');
      console.error("Failed to restore transaction from snapshot:", err);
      throw err;
    }
  } catch (err) {
    console.error("Snapshot restore failed:", err);
    throw err;
  }
}

export function deleteDbSnapshot(filename: string) {
  try {
    db.prepare('DELETE FROM snapshots_v2 WHERE filename = ?').run(filename);
    deleteSnapshotFromDiskFolders(filename);
    console.log(`Deleted snapshot: ${filename}`);
    
    // Trigger backup so deletion is propagated to backup_atlas.json
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (err) {
    console.error("Failed to delete snapshot:", err);
    throw err;
  }
}


export function importDbSnapshot(dataStr: string) {
  try {
    const data = JSON.parse(dataStr);
    const label = data.name || `Imported ${new Date().toLocaleString()}`;
    const timestamp = data.timestamp || new Date().toISOString();
    
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
    const filename = `snapshot_${Date.now()}_${safeLabel}.json`;
    
    const sizeBytes = Buffer.byteLength(dataStr, 'utf-8');
    
    const pendingCount = Array.isArray(data.pending_relationships)
      ? data.pending_relationships.filter((p: any) => p.status === 'pending').length
      : 0;

    db.prepare(`
      INSERT INTO snapshots_v2 (filename, timestamp, name, data, entity_count, relationship_count, pending_count, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      filename,
      timestamp,
      label,
      dataStr,
      data.entities ? data.entities.length : 0,
      data.relationships ? data.relationships.length : 0,
      pendingCount,
      sizeBytes
    );
    
    saveSnapshotToDiskFolders(filename, dataStr);
    console.log(`Imported custom snapshot in database and persistent disk folders: ${filename}`);
    
    return { success: true, filename, name: label };
  } catch (err) {
    console.error("Failed to import snapshot into DB:", err);
    throw err;
  }
}

export function getAllSnapshotsData() {
  try {
    const snapshots = db.prepare('SELECT * FROM snapshots_v2').all();
    const result = snapshots.map((row: any) => JSON.parse(row.data));
    return result;
  } catch (err) {
    console.error("Failed to get all snapshots data:", err);
    return [];
  }
}

export function getDeletedEntities() {
  try {
    return db.prepare('SELECT * FROM deleted_entities ORDER BY deleted_at DESC').all();
  } catch (err) {
    console.error("Failed to get deleted entities:", err);
    return [];
  }
}

export function deleteEntity(id: string) {
  try {
    const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
    if (!entity) return false;

    const filePath = entity.file_path || '';
    const filename = filePath ? path.basename(filePath, '.md') : entity.title;
    const repoDir = path.join(process.cwd(), '.data', 'repo');
    const relativePath = filePath ? path.relative(repoDir, filePath) : '';

    db.prepare(`
      INSERT OR REPLACE INTO deleted_entities (id, file_path, relative_path, filename, title, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      filePath,
      relativePath,
      filename,
      entity.title || filename,
      new Date().toISOString()
    );

    db.prepare('DELETE FROM entities WHERE id = ?').run(id);
    db.prepare('DELETE FROM relationships WHERE source = ? OR target = ?').run(id, id);
    db.prepare('DELETE FROM pending_relationships WHERE source = ? OR target = ?').run(id, id);

    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted markdown file from repository: ${filePath}`);
      } catch (fileErr) {
        console.warn(`Could not delete file ${filePath}:`, fileErr);
      }
    }

    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (err) {
    console.error("Failed to delete entity:", err);
    return false;
  }
}

export function restoreDeletedEntity(id: string) {
  try {
    db.prepare('DELETE FROM deleted_entities WHERE id = ?').run(id);
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
    Promise.resolve().then(() => backupDatabase());
    return true;
  } catch (err) {
    console.error("Failed to restore deleted entity:", err);
    return false;
  }
}

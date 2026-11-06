import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import dotenv from 'dotenv';
import { syncRepository, ingestMarkdownFiles, computeLayout, writeEntityToMarkdown, writeEntitiesToMarkdownBatch } from './src/backend/ingestion.js';
import { 
  db, 
  getEntities, 
  getRelationships, 
  getPendingRelationships, 
  approvePendingRelationship, 
  rejectPendingRelationship,
  updatePendingRelationshipType,
  updateEntityCoordinates,
  updateEntitiesCoordinatesBatch,
  getSubClusters,
  updateSubClusterTitle,
  updateSubClusterGeometry,
  createSubCluster,
  deleteSubCluster,
  renameCluster,
  createCluster,
  updateEntityDomain,
  updateEntitySubCluster,
  deleteRelationship,
  createManualRelationship,
  updateRelationshipDetails,
  updateRelationshipVisibility,
  getSnapshotsList,
  createDbSnapshot,
  restoreDbSnapshot,
  deleteDbSnapshot,
  getSnapshotData,
  importDbSnapshot,
  getAllSnapshotsData,
  deleteEntity,
  getDeletedEntities,
  restoreDeletedEntity
} from './src/backend/db.js';
import { 
  extractRelationshipsForEntity, 
  extractRelationshipsForAllEntities 
} from './src/backend/extractor.js';

dotenv.config();
console.log("DEBUG ENV: ", process.env.GITHUB_REPO_URL);
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.example', override: false });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', repo: process.env.GITHUB_REPO_URL || 'Not configured' });
  });

  // Get current graph
  app.get('/api/graph', (req, res) => {
    try {
      const entities = getEntities();
      const relationships = getRelationships();
      res.json({ entities, relationships });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update entity coordinates and optionally domain
  app.post('/api/entities/update-coordinates', (req, res) => {
    try {
      const { id, x, y, domain } = req.body;
      if (!id || x === undefined || y === undefined) {
        return res.status(400).json({ error: "Missing entity ID, x or y" });
      }
      updateEntityCoordinates(id, x, y, domain);
      writeEntityToMarkdown(id);
      res.json({ status: 'success', message: 'Entity coordinates updated.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Batch update multiple entity coordinates
  app.post('/api/entities/update-coordinates-batch', (req, res) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates)) {
        return res.status(400).json({ error: "Missing or invalid updates array" });
      }
      updateEntitiesCoordinatesBatch(updates);
      writeEntitiesToMarkdownBatch(updates.map(u => u.id));
      res.json({ status: 'success', message: 'Entities coordinates batch updated.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get all sub-clusters
  app.get('/api/sub-clusters', (req, res) => {
    try {
      const subClusters = getSubClusters();
      res.json({ subClusters });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update a sub-cluster's title
  app.post('/api/sub-clusters/update', (req, res) => {
    try {
      const { domain, sub_idx, title } = req.body;
      if (!domain || sub_idx === undefined || !title) {
        return res.status(400).json({ error: "Missing domain, sub_idx or title" });
      }
      updateSubClusterTitle(domain, Number(sub_idx), title);
      res.json({ status: 'success', message: 'Sub-cluster title updated.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Create a new sub-cluster (possibly sub-sub-cluster)
  app.post('/api/sub-clusters/create', (req, res) => {
    try {
      const { domain, parent_sub_idx, title } = req.body;
      if (!domain || !title) {
        return res.status(400).json({ error: "Missing domain or title" });
      }
      const parentIdx = (parent_sub_idx === null || parent_sub_idx === undefined) ? null : Number(parent_sub_idx);
      const sub_idx = createSubCluster(domain, parentIdx, title);
      res.json({ status: 'success', sub_idx, message: 'Sub-cluster created successfully.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete a sub-cluster
  app.post('/api/sub-clusters/delete', (req, res) => {
    try {
      const { domain, sub_idx } = req.body;
      if (!domain || sub_idx === undefined) {
        return res.status(400).json({ error: "Missing domain or sub_idx" });
      }
      deleteSubCluster(domain, Number(sub_idx));
      res.json({ status: 'success', message: 'Sub-cluster deleted successfully.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update a sub-cluster's details (title, coordinates, and/or rotation angle)
  app.post('/api/sub-clusters/update-geometry', (req, res) => {
    try {
      const { domain, sub_idx, title, x, y, angle } = req.body;
      if (!domain || sub_idx === undefined) {
        return res.status(400).json({ error: "Missing domain or sub_idx" });
      }
      updateSubClusterGeometry(domain, Number(sub_idx), title || '', x, y, angle);
      res.json({ status: 'success', message: 'Sub-cluster geometry updated.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Rename a cluster (domain)
  app.post('/api/clusters/rename', (req, res) => {
    try {
      const { oldDomain, newDomain } = req.body;
      if (!oldDomain || !newDomain) {
        return res.status(400).json({ error: "Missing oldDomain or newDomain" });
      }
      renameCluster(oldDomain, newDomain);
      res.json({ status: 'success', message: 'Cluster renamed.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Create a new cluster (domain)
  app.post('/api/clusters/create', (req, res) => {
    try {
      const { domain } = req.body;
      if (!domain) {
        return res.status(400).json({ error: "Missing domain" });
      }
      createCluster(domain);
      res.json({ status: 'success', message: 'Cluster created.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Clear new circle indicator on entity
  app.post('/api/entities/clear-new-circle', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing entity ID" });
      }
      const ent = db.prepare('SELECT tags, stage FROM entities WHERE id = ?').get(id) as any;
      if (ent) {
        let tags: string[] = [];
        try { tags = typeof ent.tags === 'string' ? JSON.parse(ent.tags) : (ent.tags || []); } catch {}
        const cleanedTags = tags.filter((t: string) => t !== '🕳' && t !== '#🕳');
        const cleanedStage = ent.stage === '🕳' ? '' : (ent.stage || '');
        db.prepare('UPDATE entities SET is_new = 0, tags = ?, stage = ? WHERE id = ?')
          .run(JSON.stringify(cleanedTags), cleanedStage, id);
      } else {
        db.prepare('UPDATE entities SET is_new = 0 WHERE id = ?').run(id);
      }
      res.json({ status: 'success', id });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update entity domain
  app.post('/api/entities/update-domain', (req, res) => {
    try {
      const { id, domain, x, y } = req.body;
      if (!id || !domain) {
        return res.status(400).json({ error: "Missing entity ID or domain" });
      }
      updateEntityDomain(id, domain, x, y);
      if (x === undefined || y === undefined) computeLayout();
      writeEntityToMarkdown(id);
      res.json({ status: 'success', message: 'Entity domain updated and layout recomputed.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update entity sub-cluster
  app.post('/api/entities/update-subcluster', (req, res) => {
    try {
      const { id, sub_idx, x, y } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing entity ID" });
      }
      updateEntitySubCluster(id, sub_idx === null || sub_idx === undefined ? null : Number(sub_idx), x, y);
      if (x === undefined || y === undefined) computeLayout();
      writeEntityToMarkdown(id);
      res.json({ status: 'success', message: 'Entity sub-cluster updated and layout recomputed.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete entity and add to sync blocklist
  app.post('/api/entities/delete', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing entity ID" });
      }
      const success = deleteEntity(id);
      if (success) {
        computeLayout();
        res.json({ status: 'success', message: 'Entity deleted from database and blocked from future syncs.' });
      } else {
        res.status(404).json({ error: 'Entity not found or could not be deleted' });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get list of deleted / blocked entities
  app.get('/api/entities/deleted', (req, res) => {
    try {
      const deleted = getDeletedEntities();
      res.json({ deleted });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Restore / unblock a deleted entity so it can sync again
  app.post('/api/entities/restore-deleted', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing entity ID" });
      }
      const success = restoreDeletedEntity(id);
      if (success) {
        res.json({ status: 'success', message: 'Entity unblocked. Future syncs will ingest this note.' });
      } else {
        res.status(500).json({ error: 'Failed to restore entity' });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/backup/download-db', (req, res) => {
    const dbPath = path.join(process.cwd(), '.data', 'atlas.db');
    if (fs.existsSync(dbPath)) {
      res.download(dbPath, 'atlas.db');
    } else {
      res.status(404).json({ error: "Database not found" });
    }
  });

  app.get('/api/backup/download-json', (req, res) => {
    const jsonPath = path.join(process.cwd(), '.data', 'backup_atlas.json');
    if (fs.existsSync(jsonPath)) {
      res.download(jsonPath, 'backup_atlas.json');
    } else {
      res.status(404).json({ error: "JSON backup not found" });
    }
  });

  app.get('/api/backup/download-snapshot/:filename', (req, res) => {
    const { filename } = req.params;
    if (!filename) {
      return res.status(400).json({ error: "Missing filename parameter" });
    }
    try {
      const dataStr = getSnapshotData(filename);
      if (dataStr) {
        res.setHeader('Content-disposition', `attachment; filename=${filename}`);
        res.setHeader('Content-type', 'application/json');
        return res.send(dataStr);
      }
      // Fallback: check filesystem directly
      const snapshotsDir = path.join(process.cwd(), '.data', 'snapshots');
      const filePath = path.join(snapshotsDir, filename);
      if (fs.existsSync(filePath)) {
        return res.download(filePath, filename);
      }
      res.status(404).json({ error: "Snapshot not found" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Create manual relationship
  app.post('/api/relationships/create', (req, res) => {
    try {
      const { source, target, type, evidence, visible } = req.body;
      if (!source || !target || !type) {
        return res.status(400).json({ error: "Missing source, target or type" });
      }
      const isVisible = visible === undefined ? true : Boolean(visible);
      const newId = createManualRelationship(source, target, type, evidence, isVisible);
      if (newId) {
        computeLayout();
        const relationship = {
          id: newId,
          source,
          target,
          type,
          weight: 2,
          evidence: evidence || 'Manually created connection',
          visible: isVisible
        };
        res.json({ status: 'success', id: newId, relationship, message: 'Manual relationship created.' });
      } else {
        res.status(500).json({ error: "Failed to create manual relationship" });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update full relationship details (type, evidence, visibility)
  app.post('/api/relationships/update', (req, res) => {
    try {
      const { id, type, evidence, visible } = req.body;
      if (!id || !type) {
        return res.status(400).json({ error: "Missing relationship ID or type" });
      }
      const isVisible = visible === undefined ? true : Boolean(visible);
      const success = updateRelationshipDetails(id, type, evidence, isVisible);
      if (success) {
        res.json({ status: 'success', message: 'Relationship updated successfully.' });
      } else {
        res.status(500).json({ error: "Failed to update relationship" });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update relationship visibility
  app.post('/api/relationships/update-visibility', (req, res) => {
    try {
      const { id, visible } = req.body;
      if (!id || visible === undefined) {
        return res.status(400).json({ error: "Missing relationship ID or visible flag" });
      }
      const success = updateRelationshipVisibility(id, Boolean(visible));
      if (success) {
        res.json({ status: 'success', message: 'Relationship visibility updated.' });
      } else {
        res.status(500).json({ error: "Failed to update relationship visibility" });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete relationship
  app.post('/api/relationships/delete', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing relationship ID" });
      }
      const success = deleteRelationship(id);
      if (success) {
        computeLayout();
        res.json({ status: 'success', message: 'Relationship deleted successfully.' });
      } else {
        res.status(500).json({ error: "Failed to delete relationship" });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get all pending relationships for review
  app.get('/api/relationships/pending', (req, res) => {
    try {
      const pending = getPendingRelationships();
      res.json({ pending });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Approve a pending relationship
  app.post('/api/relationships/approve', (req, res) => {
    try {
      const { id, type } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing relationship ID" });
      }
      const success = approvePendingRelationship(id, type);
      if (success) {
        computeLayout();
        res.json({ status: 'success', message: 'Relationship approved and added to graph.' });
      } else {
        res.status(404).json({ error: 'Pending relationship not found.' });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update a pending relationship's type
  app.post('/api/relationships/update-type', (req, res) => {
    try {
      const { id, type } = req.body;
      if (!id || !type) {
        return res.status(400).json({ error: "Missing relationship ID or type" });
      }
      const success = updatePendingRelationshipType(id, type);
      if (success) {
        res.json({ status: 'success', message: 'Relationship type updated.' });
      } else {
        res.status(404).json({ error: 'Pending relationship not found.' });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Reject a pending relationship
  app.post('/api/relationships/reject', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Missing relationship ID" });
      }
      const success = rejectPendingRelationship(id);
      if (success) {
        computeLayout();
        res.json({ status: 'success', message: 'Relationship rejected.' });
      } else {
        res.status(404).json({ error: 'Pending relationship not found.' });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Snapshots API ---
  // Get all snapshots
  app.get('/api/snapshots', (req, res) => {
    try {
      const snapshots = getSnapshotsList();
      res.json({ snapshots });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Create snapshot
  app.post('/api/snapshots/create', (req, res) => {
    try {
      const { name } = req.body;
      const result = createDbSnapshot(name);
      res.json({ status: 'success', ...result, message: 'Snapshot created successfully.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Restore snapshot
  app.post('/api/snapshots/restore', (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename) {
        return res.status(400).json({ error: "Missing snapshot filename" });
      }
      restoreDbSnapshot(filename);
      res.json({ status: 'success', message: 'Snapshot restored successfully.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete snapshot
  app.post('/api/snapshots/delete', (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename) {
        return res.status(400).json({ error: "Missing snapshot filename" });
      }
      deleteDbSnapshot(filename);
      res.json({ status: 'success', message: 'Snapshot deleted successfully.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Import snapshot
  app.post("/api/snapshots/import", (req, res) => {
    try {
      const { data } = req.body;
      if (!data) {
        return res.status(400).json({ error: "Missing snapshot data" });
      }
      const result = importDbSnapshot(data);
      res.json({ status: "success", ...result, message: "Snapshot imported successfully." });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Download all snapshots
  app.get("/api/backup/download-all-snapshots", (req, res) => {
    try {
      const allSnapshots = getAllSnapshotsData();
      const filename = `all_snapshots_${Date.now()}.json`;
      res.setHeader("Content-disposition", `attachment; filename=${filename}`);
      res.setHeader("Content-type", "application/json");
      res.send(JSON.stringify(allSnapshots, null, 2));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Trigger LLM-assisted extraction
  app.post('/api/relationships/extract', async (req, res) => {
    try {
      const { entityId, model } = req.body;
      const selectedModel = model || "gemini-3.5-flash";
      
      if (entityId) {
        console.log(`Starting LLM relationship extraction for entity: ${entityId} using model: ${selectedModel}`);
        const count = await extractRelationshipsForEntity(entityId, selectedModel);
        res.json({ status: 'success', count, message: `Extracted ${count} pending relationships for this node.` });
      } else {
        console.log(`Starting LLM relationship extraction for the entire garden using model: ${selectedModel}`);
        const count = await extractRelationshipsForAllEntities();
        res.json({ status: 'success', count, message: `Extracted ${count} pending relationships across the entire digital garden.` });
      }
    } catch (error) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Trigger sync
  app.post('/api/sync', async (req, res) => {
    try {
      const { syncMode = 'curated' } = req.body || {};
      const repoUrl = process.env.GITHUB_REPO_URL;
      if (!repoUrl) {
        throw new Error("GITHUB_REPO_URL environment variable is not set.");
      }
      
      console.log(`Starting sync for: ${repoUrl} (mode: ${syncMode})`);
      const repoPath = await syncRepository(repoUrl);
      
      console.log(`Ingesting markdown files from: ${repoPath} (mode: ${syncMode})`);
      await ingestMarkdownFiles(repoPath, syncMode as 'curated' | 'raw');
      
      try {
        createDbSnapshot(`Auto-sync Snapshot (${new Date().toLocaleString()})`);
      } catch (snapErr) {
        console.warn("Failed to create post-sync snapshot:", snapErr);
      }

      res.json({ status: 'success', syncMode, message: 'Sync and ingestion complete.' });
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Promote raw note to curated domain and sub-cluster
  app.post('/api/raw-notes/promote', (req, res) => {
    try {
      const { id, domain, sub_idx } = req.body;
      if (!id || !domain) {
        return res.status(400).json({ error: "id and domain are required." });
      }
      const entity = db.prepare('SELECT tags FROM entities WHERE id = ?').get(id) as any;
      let tags: string[] = [];
      if (entity && entity.tags) {
        try {
          tags = JSON.parse(entity.tags);
        } catch {
          tags = [];
        }
      }
      const updatedTags = tags.filter(t => t !== '🕳' && t !== '#🕳');
      db.prepare('UPDATE entities SET domain = ?, sub_idx = ?, tags = ? WHERE id = ?')
        .run(domain, sub_idx !== undefined ? sub_idx : null, JSON.stringify(updatedTags), id);
      
      writeEntityToMarkdown(id);
      res.json({ status: 'success' });
    } catch (error) {
      console.error('Promote raw note error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

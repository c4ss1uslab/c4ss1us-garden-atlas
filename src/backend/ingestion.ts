import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import { 
  db,
  clearDatabase, 
  insertEntity, 
  insertRelationship, 
  getEntities, 
  getRelationships, 
  updateEntityCoordinates,
  deleteAutoRelationshipsForEntity,
  getSubClusters,
  backupDatabase,
  getDeletedEntities
} from './db.js';
import { v4 as uuidv4 } from 'uuid';
import { unified } from 'unified';
import _remarkParse from 'remark-parse';
import _remarkFrontmatter from 'remark-frontmatter';
const remarkParse = (_remarkParse as any).default || _remarkParse;
const remarkFrontmatter = (_remarkFrontmatter as any).default || _remarkFrontmatter;
import { visit } from 'unist-util-visit';
import * as yaml from 'js-yaml';
import * as d3 from 'd3';

const REPO_DIR = path.join(process.cwd(), '.data', 'repo');

export async function syncRepository(repoUrl: string): Promise<string> {
  try {
    if (!fs.existsSync(REPO_DIR)) {
      fs.mkdirSync(REPO_DIR, { recursive: true });
      console.log(`Cloning ${repoUrl} to ${REPO_DIR}...`);
      await simpleGit().clone(repoUrl, REPO_DIR);
    } else {
      console.log(`Pulling latest from ${repoUrl}...`);
      try {
        await simpleGit(REPO_DIR).pull();
      } catch (pullErr) {
        console.warn("Pull failed, probably due to index/repo corruption. Deleting and re-cloning...", pullErr);
        fs.rmSync(REPO_DIR, { recursive: true, force: true });
        fs.mkdirSync(REPO_DIR, { recursive: true });
        await simpleGit().clone(repoUrl, REPO_DIR);
      }
    }
  } catch (err) {
    console.error("Git sync encountered a critical failure. Attempting full fresh clone fallback:", err);
    try {
      if (fs.existsSync(REPO_DIR)) {
        fs.rmSync(REPO_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(REPO_DIR, { recursive: true });
      await simpleGit().clone(repoUrl, REPO_DIR);
    } catch (fallbackErr) {
      console.error("Both primary sync and fallback clone failed:", fallbackErr);
      throw fallbackErr;
    }
  }
  return REPO_DIR;
}

function findMarkdownFiles(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory()) {
      if (file !== '.git' && file !== 'node_modules') {
        findMarkdownFiles(path.join(dir, file), fileList);
      }
    } else if (file.endsWith('.md')) {
      fileList.push(path.join(dir, file));
    }
  }
  return fileList;
}

export function determineDomain(filePath: string, parsedFrontmatter: any, tags: string[]): string {
  if (parsedFrontmatter && parsedFrontmatter.domain) {
    const d = parsedFrontmatter.domain.trim().toLowerCase();
    if (d === 'l1f3') return 'L1F3';
    if (d === 'ai') return 'AI';
    if (['research', 'design', 'lab', 'alchemy', 'art', 'regen', 'host', 'music', 'player', 'uncategorized'].includes(d)) {
      return d;
    }
  }

  if (Array.isArray(tags)) {
    const cleanTags = tags.map(t => t.replace(/^#/, '').trim().toLowerCase());
    if (cleanTags.includes('l1f3')) return 'L1F3';
    if (cleanTags.includes('ai')) return 'AI';
    if (cleanTags.includes('music')) return 'music';
    if (cleanTags.includes('host')) return 'host';
    if (cleanTags.includes('alchemy')) return 'alchemy';
    if (cleanTags.includes('regen')) return 'regen';
    if (cleanTags.includes('art')) return 'art';
    if (cleanTags.includes('player')) return 'player';
    if (cleanTags.includes('design')) return 'design';
    if (cleanTags.includes('lab')) return 'lab';
    if (cleanTags.includes('research') || cleanTags.includes('log')) return 'research';

    if (cleanTags.some(t => ['knowledgemanagement', 'sensemaking', 'framework'].includes(t))) {
      return 'research';
    }
    if (cleanTags.some(t => ['metacrisis'].includes(t))) {
      return 'design';
    }
    if (cleanTags.some(t => ['open-source'].includes(t))) {
      return 'lab';
    }
  }

  const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
  if (normalizedPath.includes('/_003_l1f3/') || normalizedPath.includes('/l1f3/') || normalizedPath.includes('l1f3 player toolkit')) {
    return 'L1F3';
  }
  if (normalizedPath.includes('/_001_research/') || normalizedPath.includes('/research/')) {
    return 'research';
  }
  if (normalizedPath.includes('/music/')) {
    return 'music';
  }
  if (normalizedPath.includes('/host/')) {
    return 'host';
  }
  if (normalizedPath.includes('/alchemy/')) {
    return 'alchemy';
  }
  if (normalizedPath.includes('/design/')) {
    return 'design';
  }
  if (normalizedPath.includes('/lab/')) {
    return 'lab';
  }
  if (normalizedPath.includes('/art/')) {
    return 'art';
  }
  if (normalizedPath.includes('/regen/')) {
    return 'regen';
  }
  if (normalizedPath.includes('/player/')) {
    return 'player';
  }
  if (normalizedPath.includes('/ai/')) {
    return 'AI';
  }

  return 'uncategorized';
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

function getTopTopics(mdFiles: string[]): string[] {
  const EXCLUDED_TOPIC_TAGS = new Set([
    'stub', '🌱', '🌿', '🌲', '🕳',
    'concept', 'project', 'person', 'tool', 'topic', 'resource', 'organization', 'essay', 'response', 'experiment',
    'actors', 'projects', 'knowledge', 'sources', 'original', 'note', 'notes', 'highlights', 'tier1', 'tier2', 'uncategorized',
    'log'
  ]);

  const counts: Record<string, number> = {};

  for (const file of mdFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parser = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml']);
      const tree = parser.parse(content);

      visit(tree, 'yaml', (node: any) => {
        try {
          const parsed: any = yaml.load(node.value);
          if (parsed && Array.isArray(parsed.tags)) {
            parsed.tags.forEach((t: string) => {
              const clean = t.replace(/^#/, '').trim().toLowerCase();
              if (clean && !EXCLUDED_TOPIC_TAGS.has(clean)) {
                counts[clean] = (counts[clean] || 0) + 1;
              }
            });
          }
        } catch {}
      });
    } catch {}
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  return sorted.slice(0, 12);
}

export async function ingestMarkdownFiles(repoPath: string, syncMode: 'curated' | 'raw' = 'curated') {
  const mdFiles = findMarkdownFiles(repoPath);
  const dynamicTopics = getTopTopics(mdFiles);
  console.log(`[Ingestion] Starting ingestion in mode '${syncMode}' for ${mdFiles.length} files.`);

  const deletedEntities = getDeletedEntities();
  const deletedFilePaths = new Set(deletedEntities.map((d: any) => d.file_path ? path.normalize(d.file_path).toLowerCase() : '').filter(Boolean));
  const deletedRelPaths = new Set(deletedEntities.map((d: any) => d.relative_path ? path.normalize(d.relative_path).toLowerCase() : '').filter(Boolean));
  const deletedFilenames = new Set(deletedEntities.map((d: any) => (d.filename || '').toLowerCase().trim()).filter(Boolean));
  const deletedTitles = new Set(deletedEntities.map((d: any) => (d.title || '').toLowerCase().trim()).filter(Boolean));

  const existingEntities = getEntities();
  const entityMap = new Map<string, string>(); // filename to id

  // Helper to find existing entity matching this file
  const findMatchingEntity = (file: string, filename: string, parsedTitle?: string, parsedPermalink?: string) => {
    const normFile = path.normalize(file).toLowerCase();
    const relFile = path.relative(repoPath, file).toLowerCase().replace(/\\/g, '/');
    const fnLower = filename.toLowerCase().trim();
    const ptLower = parsedTitle ? parsedTitle.toLowerCase().trim() : null;
    const permLower = parsedPermalink ? parsedPermalink.toLowerCase().trim() : null;

    const cleanName = (s: string) => s.replace(/^[\d\s_#⛓🕳🌱🌿🌲—\-]+/, '').replace(/\.md$/i, '').trim().toLowerCase();
    const fnClean = cleanName(filename);
    const ptClean = ptLower ? cleanName(ptLower) : null;

    const slugify = (s: string) => s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const fnSlug = slugify(filename);
    const ptSlug = ptLower ? slugify(ptLower) : null;

    // 1. Exact absolute file_path match
    let found = existingEntities.find(e => e.file_path && path.normalize(e.file_path).toLowerCase() === normFile);
    if (found) return found;

    // 2. Relative file_path match
    found = existingEntities.find(e => {
      if (!e.file_path) return false;
      const relE = path.relative(repoPath, e.file_path).toLowerCase().replace(/\\/g, '/');
      const normE = e.file_path.toLowerCase().replace(/\\/g, '/');
      return relE === relFile || normE.endsWith(relFile);
    });
    if (found) return found;

    // 3. File path ending match (e.g. ends with /filename.md)
    found = existingEntities.find(e => {
      if (!e.file_path) return false;
      const normE = path.normalize(e.file_path).toLowerCase();
      return normE === `${fnLower}.md` || normE.endsWith(`/${fnLower}.md`) || normE.endsWith(`\\${fnLower}.md`);
    });
    if (found) return found;

    // 4. Exact title matches filename or parsedTitle
    found = existingEntities.find(e => {
      const eTitleLower = e.title.toLowerCase().trim();
      return eTitleLower === fnLower || (ptLower && eTitleLower === ptLower);
    });
    if (found) return found;

    // 5. Permalink match
    if (permLower) {
      found = existingEntities.find(e => e.permalink && e.permalink.toLowerCase().trim() === permLower);
      if (found) return found;
    }

    // 6. Cleaned / stripped name match
    if (fnClean) {
      found = existingEntities.find(e => cleanName(e.title) === fnClean || (e.file_path && cleanName(path.basename(e.file_path)) === fnClean));
      if (found) return found;
    }
    if (ptClean) {
      found = existingEntities.find(e => cleanName(e.title) === ptClean);
      if (found) return found;
    }

    // 7. Slugified match
    if (fnSlug) {
      found = existingEntities.find(e => slugify(e.title) === fnSlug);
      if (found) return found;
    }
    if (ptSlug) {
      found = existingEntities.find(e => slugify(e.title) === ptSlug);
      if (found) return found;
    }

    return null;
  };

  const mdFileDetails: Array<{
    file: string;
    content: string;
    filename: string;
    existing: any;
    isNew: boolean;
    isModified: boolean;
  }> = [];

  // First pass: identify state of files
  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const filename = path.basename(file, '.md');
    const relativePath = path.relative(repoPath, file);
    const normalizedFullPath = path.normalize(file).toLowerCase();
    const normalizedRelPath = path.normalize(relativePath).toLowerCase();
    const fnLower = filename.toLowerCase().trim();

    // Parse frontmatter briefly to find any parsed title
    let parsedTitle = filename;
    try {
      const parser = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml']);
      const tree = parser.parse(content);
      visit(tree, 'yaml', (node: any) => {
        try {
          const parsed: any = yaml.load(node.value);
          if (parsed && parsed.title) {
            parsedTitle = parsed.title;
          }
        } catch {}
      });
    } catch {}

    // Check if blacklisted as deleted
    let isDeleted = false;
    if (deletedFilePaths.has(normalizedFullPath)) isDeleted = true;
    if (deletedRelPaths.has(normalizedRelPath)) isDeleted = true;
    if (deletedFilenames.has(fnLower)) isDeleted = true;
    if (deletedTitles.has(parsedTitle.toLowerCase().trim())) isDeleted = true;

    if (isDeleted) {
      console.log(`[Ingestion Sync] Skipping deleted note: ${relativePath}`);
      try {
        db.prepare('DELETE FROM entities WHERE file_path = ? OR title = ?').run(file, parsedTitle);
      } catch {}
      continue;
    }

    const existing = findMatchingEntity(file, filename, parsedTitle);
    const isNew = !existing;
    const isModified = existing ? existing.content !== content : false;

    mdFileDetails.push({
      file,
      content,
      filename,
      existing,
      isNew,
      isModified
    });

    if (existing) {
      entityMap.set(filename, existing.id);
    }
  }

  const subClusters = getSubClusters();

  // Process and save entities
  for (const detail of mdFileDetails) {
    const { file, content, filename, existing, isNew, isModified } = detail;
    
    let id = existing ? existing.id : uuidv4();
    entityMap.set(filename, id);

    let title = filename;
    let type = 'note';
    let domain = 'uncategorized';
    let scale = 'street';
    let tags: string[] = [];
    let description = '';
    let permalink = '';
    let stage = '';
    let relevance = 0;

    const parser = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ['yaml']);

    const tree = parser.parse(content);
    let parsed: any = null;

    visit(tree, 'yaml', (node: any) => {
      try {
        parsed = yaml.load(node.value);
        if (parsed) {
          title = parsed.title || title;
          type = parsed.type || type;
          scale = parsed.scale || scale;
          tags = parsed.tags || [];
          description = parsed.description || description;
          permalink = parsed.permalink || permalink;
          
          if (parsed.notestage && Array.isArray(parsed.notestage) && parsed.notestage.length > 0) {
            stage = parsed.notestage[0];
          } else if (parsed.notestage && typeof parsed.notestage === 'string') {
            stage = parsed.notestage;
          }
          
          if (parsed.relevancescore !== undefined) {
            relevance = Number(parsed.relevancescore);
          }
          
          type = determineTypeFromTags(tags, type);
        }
      } catch (e) {
        console.warn(`Failed to parse frontmatter in ${file}`, e);
      }
    });

    // In Raw Mode, automatically append #🕳 tag to new/existing notes if not present
    if (syncMode === 'raw') {
      if (!tags.some(t => t === '🕳' || t === '#🕳')) {
        tags.push('🕳');
      }
      if (!stage) {
        stage = '🕳';
      }
    }

    let x = 0;
    let y = 0;
    let sub_idx: number | null = null;
    let pinned = 0;

    if (existing) {
      // EXISTING NOTE: STRICTLY PRESERVE domain, sub_idx, x, y, pinned from DB!
      // Do NOT change domain, sub-cluster assignment, or position on sync!
      domain = existing.domain;
      sub_idx = existing.sub_idx;
      x = existing.x || 0;
      y = existing.y || 0;
      pinned = existing.pinned || 0;
    } else {
      // NEW NOTE: Determine domain, sub_idx, and initial coordinates
      domain = determineDomain(file, parsed, tags);

      if (parsed && parsed.sub_idx !== undefined && parsed.sub_idx !== null) {
        sub_idx = Number(parsed.sub_idx);
      } else {
        // Try matching tags to sub-cluster titles in this domain
        const domainSubs = subClusters.filter((s: any) => s.domain === domain);
        let matchedSub = null;
        if (domainSubs.length > 0 && tags.length > 0) {
          const cleanTags = tags.map(t => t.replace(/^#/, '').toLowerCase().trim());
          matchedSub = domainSubs.find((s: any) => {
            const stTitle = (s.title || '').toLowerCase();
            return cleanTags.some(tag => tag.length > 2 && stTitle.includes(tag));
          });
        }
        if (matchedSub) {
          sub_idx = matchedSub.sub_idx;
        } else {
          sub_idx = 0;
        }
      }

      if (parsed && parsed.x !== undefined && parsed.y !== undefined && (Number(parsed.x) !== 0 || Number(parsed.y) !== 0)) {
        x = Number(parsed.x);
        y = Number(parsed.y);
      } else {
        // Calculate initial position near existing nodes in the target domain/sub-cluster
        const targetSubNodes = existingEntities.filter((e: any) => e.domain === domain && e.sub_idx === sub_idx && (e.x !== 0 || e.y !== 0));
        if (targetSubNodes.length > 0) {
          const avgX = targetSubNodes.reduce((sum: number, e: any) => sum + e.x, 0) / targetSubNodes.length;
          const avgY = targetSubNodes.reduce((sum: number, e: any) => sum + e.y, 0) / targetSubNodes.length;
          x = avgX + (Math.random() - 0.5) * 60;
          y = avgY + (Math.random() - 0.5) * 60;
        } else {
          const domainNodes = existingEntities.filter((e: any) => e.domain === domain && (e.x !== 0 || e.y !== 0));
          if (domainNodes.length > 0) {
            const avgX = domainNodes.reduce((sum: number, e: any) => sum + e.x, 0) / domainNodes.length;
            const avgY = domainNodes.reduce((sum: number, e: any) => sum + e.y, 0) / domainNodes.length;
            x = avgX + (Math.random() - 0.5) * 100;
            y = avgY + (Math.random() - 0.5) * 100;
          } else {
            const allowedDomains = ['uncategorized', 'lab', 'design', 'research', 'alchemy', 'art', 'regen', 'host', 'music', 'player', 'L1F3', 'AI'];
            const domainIdx = allowedDomains.indexOf(domain);
            const idxToUse = domainIdx >= 0 ? domainIdx : 0;
            const angle = (idxToUse / allowedDomains.length) * Math.PI * 2;
            const radius = 800;
            x = Math.cos(angle) * radius + (Math.random() - 0.5) * 80;
            y = Math.sin(angle) * radius + (Math.random() - 0.5) * 80;
          }
        }
      }
    }

    insertEntity({
      id,
      title,
      type,
      domain,
      scale,
      description,
      tags,
      content,
      permalink,
      stage,
      relevance,
      x,
      y,
      sub_idx,
      file_path: file,
      pinned
    });

    if (isModified) {
      deleteAutoRelationshipsForEntity(id);
    }
  }

  // Second pass: extract links as relationships for new and modified entities
  for (const detail of mdFileDetails) {
    const { content, filename, isNew, isModified } = detail;
    if (!isNew && !isModified) {
      // Unchanged node: do not re-extract or touch relationships!
      continue;
    }

    const sourceId = entityMap.get(filename);
    if (!sourceId) continue;

    const parser = unified().use(remarkParse);
    const tree = parser.parse(content);
    const targets = new Set<string>();

    visit(tree, 'link', (node: any) => {
      const url = node.url;
      if (url && url.endsWith('.md') && !url.startsWith('http')) {
        const targetFilename = path.basename(url, '.md');
        if (entityMap.has(targetFilename)) {
          targets.add(entityMap.get(targetFilename)!);
        }
      }
    });

    const wikiRegex = /\[\[(.*?)\]\]/g;
    let match;
    while ((match = wikiRegex.exec(content)) !== null) {
      const parts = match[1].split('|');
      const targetPath = parts[0].trim();
      const targetName = targetPath.split('/').pop() || targetPath;
      if (entityMap.has(targetName)) {
        targets.add(entityMap.get(targetName)!);
      }
    }

    targets.forEach(targetId => {
      insertRelationship({
        id: uuidv4(),
        source: sourceId,
        target: targetId,
        type: 'references',
        weight: 1
      });
    });
  }
}

export function computeLayout() {
  const entities = getEntities();

  if (entities.length === 0) return;

  const subClusters = getSubClusters();

  // Simple domains for clustering (perfectly aligned with client's generateClusters)
  const allowed = ['uncategorized', 'lab', 'design', 'research', 'alchemy', 'art', 'regen', 'host', 'music', 'player', 'L1F3', 'AI'];
  const rawDomains = [...new Set([
    ...entities.map((e: any) => String(e.domain || 'uncategorized')),
    ...subClusters.map((sc: any) => sc.domain)
  ])].filter(d => allowed.includes(d) && !['metacrisis', 'sensemaking', 'knowledgemanagement', 'athlete'].includes(d.toLowerCase()));

  const orderedList = ['uncategorized', 'lab', 'design', 'research', 'alchemy', 'art', 'regen', 'host', 'music', 'player', 'L1F3', 'AI'];
  const domains = [
    ...orderedList.filter(d => rawDomains.includes(d)),
    ...rawDomains.filter(d => !orderedList.includes(d)).sort()
  ];

  const clusterCenters = domains.map((domain, i) => {
    return {
      domain,
      x: Math.cos((i / domains.length) * Math.PI * 2) * 800,
      y: Math.sin((i / domains.length) * Math.PI * 2) * 800
    };
  });

  // Helper to get target coordinates for a sub-cluster (supporting nested sub-sub-clusters)
  function getSubClusterTarget(subIdx: number, numSubClusters: number, domain: string, cluster: { x: number, y: number }) {
    const sc = subClusters.find((s: any) => s.domain === domain && s.sub_idx === subIdx);
    const parentIdx = sc ? sc.parent_sub_idx : null;
    
    if (parentIdx !== null && parentIdx !== undefined) {
      const parentAngle = (parentIdx / numSubClusters) * Math.PI * 2;
      const parentDist = Math.min(450, Math.max(200, numSubClusters * 75));
      
      const childAngle = parentAngle + 0.35;
      const childDist = parentDist + 160;
      return {
        x: cluster.x + Math.cos(childAngle) * childDist,
        y: cluster.y + Math.sin(childAngle) * childDist
      };
    } else {
      if (numSubClusters <= 1) {
        return { x: cluster.x, y: cluster.y };
      }
      const angle = (subIdx / numSubClusters) * Math.PI * 2;
      const dist = Math.min(450, Math.max(200, numSubClusters * 75));
      return {
        x: cluster.x + Math.cos(angle) * dist,
        y: cluster.y + Math.sin(angle) * dist
      };
    }
  }

  // Assign each entity deterministic sub-cluster and offset coordinates
  const entitiesWithSubClusters = entities.map((e: any) => {
    const domainEntities = entities.filter((de: any) => de.domain === e.domain);
    const sorted = [...domainEntities].sort((a: any, b: any) => a.id.localeCompare(b.id));
    const idx = sorted.findIndex((de: any) => de.id === e.id);
    
    const maxAssignedSubIdx = domainEntities.reduce((max: number, de: any) => {
      return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
    }, -1);
    
    let numSubClusters = Math.min(8, Math.max(1, Math.floor(domainEntities.length / 3)));
    if (maxAssignedSubIdx >= numSubClusters) {
      numSubClusters = maxAssignedSubIdx + 1;
    }

    let subIdx = (e.sub_idx !== null && e.sub_idx !== undefined)
      ? e.sub_idx
      : idx % numSubClusters;
    
    const res: any = {
      ...e,
      subIdx,
      numSubClusters
    };

    const hasPosition = (e.x !== null && e.x !== undefined && e.y !== null && e.y !== undefined) && (e.x !== 0 || e.y !== 0 || e.pinned === 1 || e.pinned === true);
    if (hasPosition) {
      res.x = e.x;
      res.y = e.y;
      // LOCK existing node positions so d3 simulation NEVER moves or recalculates existing nodes!
      res.fx = e.x;
      res.fy = e.y;
      res.isLocked = true;
    } else {
      res.isLocked = false;
      const cluster = clusterCenters.find(c => c.domain === e.domain);
      if (cluster) {
        const target = getSubClusterTarget(subIdx, numSubClusters, e.domain, cluster);
        res.x = target.x + (Math.random() - 0.5) * 80;
        res.y = target.y + (Math.random() - 0.5) * 80;
      } else {
        // Dark forest / Uncategorized raw notes target center
        res.x = (Math.random() - 0.5) * 300;
        res.y = (Math.random() - 0.5) * 300;
      }
    }

    // Jitter if position is exact 0,0 to allow d3 forces to separate overlapping nodes
    if (res.x === 0 && res.y === 0 && !res.isLocked) {
      res.x = (Math.random() - 0.5) * 200;
      res.y = (Math.random() - 0.5) * 200;
    }

    return res;
  });

  // Run simulation statically to let positions resolve ONLY for unlocked (new/unpositioned) nodes
  const unlockedNodes = entitiesWithSubClusters.filter((e: any) => !e.isLocked);
  if (unlockedNodes.length > 0) {
    const simulation = d3.forceSimulation(entitiesWithSubClusters as any)
      .force('charge', d3.forceManyBody().strength(-150))
      .force('collide', d3.forceCollide().radius((d: any) => {
          const contentLength = (d.content || '').length;
          const radius = contentLength >= 2500 ? 12 : (contentLength >= 600 ? 8 : 5);
          return radius + 22;
      }).iterations(3))
      .force('x', d3.forceX().x((d: any) => {
          const cluster = clusterCenters.find(c => c.domain === d.domain);
          if (!cluster) return 0;
          const target = getSubClusterTarget(d.subIdx, d.numSubClusters, d.domain, cluster);
          return target.x;
      }).strength(0.28))
      .force('y', d3.forceY().y((d: any) => {
          const cluster = clusterCenters.find(c => c.domain === d.domain);
          if (!cluster) return 0;
          const target = getSubClusterTarget(d.subIdx, d.numSubClusters, d.domain, cluster);
          return target.y;
      }).strength(0.28))
      .stop();

    for (let i = 0; i < 300; i++) {
      simulation.tick();
    }
  }

  // Save coordinates back to DB ONLY for nodes that were new/unlocked
  let madeChanges = false;
  for (const entity of entitiesWithSubClusters) {
    if (!entity.isLocked) {
      db.prepare('UPDATE entities SET x = ?, y = ?, sub_idx = ? WHERE id = ?').run(
        entity.x || 0,
        entity.y || 0,
        entity.subIdx,
        entity.id
      );
      writeEntityToMarkdown(entity.id);
      madeChanges = true;
    } else if (entity.sub_idx === null || entity.sub_idx === undefined) {
      db.prepare('UPDATE entities SET sub_idx = ? WHERE id = ?').run(
        entity.subIdx,
        entity.id
      );
      madeChanges = true;
    }
  }
  if (madeChanges) {
    backupDatabase();
  }
}

export function writeEntityToMarkdown(id: string) {
  try {
    const row = db.prepare('SELECT x, y, domain, sub_idx, file_path, pinned FROM entities WHERE id = ?').get(id) as any;
    if (!row || !row.file_path) {
      console.warn(`No file path found for entity ${id}, cannot update markdown frontmatter.`);
      return;
    }
    
    const filePath = row.file_path;
    if (!fs.existsSync(filePath)) {
      console.warn(`File does not exist: ${filePath}`);
      return;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    
    let fmData: any = {};
    let mainContent = content;
    
    if (match) {
      const fmText = match[1];
      mainContent = match[2];
      try {
        fmData = yaml.load(fmText) || {};
      } catch (e) {
        console.error(`Failed to parse frontmatter for ${filePath}:`, e);
      }
    }
    
    // Update fields
    fmData.x = Number((row.x || 0).toFixed(2));
    fmData.y = Number((row.y || 0).toFixed(2));
    fmData.domain = row.domain;
    fmData.sub_idx = row.sub_idx !== null && row.sub_idx !== undefined ? Number(row.sub_idx) : null;
    fmData.pinned = row.pinned ? 1 : 0;
    
    const newFmText = yaml.dump(fmData, { lineWidth: -1 }).trim();
    const newContent = `---\n${newFmText}\n---\n${mainContent}`;
    
    fs.writeFileSync(filePath, newContent, 'utf-8');
    console.log(`Successfully persisted state to markdown: ${filePath}`);
  } catch (err) {
    console.error(`Error in writeEntityToMarkdown for ${id}:`, err);
  }
}

export function writeEntitiesToMarkdownBatch(ids: string[]) {
  for (const id of ids) {
    writeEntityToMarkdown(id);
  }
}

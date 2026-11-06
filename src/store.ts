import { create } from 'zustand';
import { Entity, Relationship, DomainCluster } from './types';

interface MapState {
  entities: Entity[];
  relationships: Relationship[];
  clusters: DomainCluster[];
  selectedEntityId: string | null;
  hoveredEntityId: string | null;
  searchQuery: string;
  zoomLevel: number;
  stageFilters: string[];
  minRelevance: number;
  selectedDomains: string[];
  selectedTypes: string[];
  selectedTags: string[];
  excludedSubTags: string[];
  viewMode: 'cluster' | 'darkforest' | 'graph' | 'edit';
  subClusters: Array<{ domain: string; sub_idx: number; title: string; x?: number | null; y?: number | null; angle?: number | null; parent_sub_idx?: number | null }>;
  isEditUnlocked: boolean;
  isConnectToolActive: boolean;
  connectLineStyle: 'solid' | 'dotted';
  
  setEntities: (entities: Entity[]) => void;
  setRelationships: (relationships: Relationship[]) => void;
  selectEntity: (id: string | null) => void;
  hoverEntity: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setZoomLevel: (level: number) => void;
  toggleStageFilter: (stage: string) => void;
  setMinRelevance: (relevance: number) => void;
  toggleDomainFilter: (domain: string) => void;
  toggleTypeFilter: (type: string) => void;
  toggleTagFilter: (tag: string) => void;
  toggleSubTagExclude: (tag: string) => void;
  clearAllFilters: () => void;
  setViewMode: (mode: 'cluster' | 'darkforest' | 'graph' | 'edit') => void;
  setEditUnlocked: (unlocked: boolean) => void;
  setConnectToolActive: (active: boolean) => void;
  toggleConnectTool: () => void;
  setConnectLineStyle: (style: 'solid' | 'dotted') => void;
  setSubClusters: (subClusters: Array<{ domain: string; sub_idx: number; title: string; x?: number | null; y?: number | null; angle?: number | null; parent_sub_idx?: number | null }>) => void;
  updateSubClusterInStore: (domain: string, sub_idx: number, title: string, parent_sub_idx?: number | null) => void;
  deleteSubClusterInStore: (domain: string, sub_idx: number) => void;
  updateEntityCoordinatesInStore: (id: string, x: number, y: number, domain?: string) => void;
  updateEntityDomainInStore: (id: string, domain: string) => void;
  updateEntitySubClusterInStore: (id: string, sub_idx: number | null) => void;
  deleteEntityInStore: (id: string) => void;
  renameClusterInStore: (oldDomain: string, newDomain: string) => void;
  createClusterInStore: (domain: string) => void;
}

const normalizeDomain = (rawDomain: string): string => {
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
};

const generateClusters = (entities: Entity[], subClusters: Array<{ domain: string }> = []): DomainCluster[] => {
  const allowed = ['uncategorized', 'lab', 'design', 'research', 'alchemy', 'art', 'regen', 'host', 'music', 'player', 'L1F3', 'AI'];
  const rawDomains = [...new Set([
    ...entities.map(e => e.domain),
    ...subClusters.map(sc => sc.domain)
  ])].filter(d => allowed.includes(d) && !['metacrisis', 'sensemaking', 'knowledgemanagement', 'athlete'].includes(d.toLowerCase()));
  
  const orderedList = ['uncategorized', 'lab', 'design', 'research', 'alchemy', 'art', 'regen', 'host', 'music', 'player', 'L1F3', 'AI'];
  const domains = [
    ...orderedList.filter(d => rawDomains.includes(d)),
    ...rawDomains.filter(d => !orderedList.includes(d)).sort()
  ];
  
  const predefinedColors: Record<string, string> = {
    'uncategorized': '#475569', // Slate-600
    'research': '#64748b', // slate
    'design': '#06b6d4', // cyan
    'lab': '#0ea5e9', // light blue
    'alchemy': '#9333ea', // purple
    'art': '#f97316', // orange
    'host': '#eab308', // yellow
    'regen': '#10b981', // emerald
    'music': '#1e40af', // dark blue
    'player': '#ec4899', // pink
    'L1F3': '#fcd34d', // yellow-300
    'AI': '#3b82f6', // blue
  };
  
  const fallbackColors = ['#6366f1', '#14b8a6', '#d946ef', '#06b6d4', '#84cc16'];
  let fallbackIdx = 0;
  
  return domains.map((domain, i) => ({
    id: domain,
    name: domain,
    color: predefinedColors[domain] || fallbackColors[fallbackIdx++ % fallbackColors.length],
    x: Math.cos((i / domains.length) * Math.PI * 2) * 800,
    y: Math.sin((i / domains.length) * Math.PI * 2) * 800,
  }));
};

export const calculateNewNodeCoordinates = (
  entities: Entity[], 
  subClusters: Array<{ domain: string; sub_idx: number; title: string; x?: number | null; y?: number | null; parent_sub_idx?: number | null }>, 
  domain: string, 
  subIdx: number | null,
  entityId?: string
): { x: number, y: number } => {
  const clusterEntities = entities
    .filter(e => e.domain === domain)
    .sort((a, b) => a.id.localeCompare(b.id));

  const maxAssignedSubIdx = clusterEntities.reduce((max: number, de: any) => {
    return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
  }, -1);
  
  const domainSubs = subClusters.filter(s => s.domain === domain && (s.parent_sub_idx === null || s.parent_sub_idx === undefined));
  const maxSubClusterIdx = domainSubs.reduce((max: number, ds: any) => {
    return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
  }, -1);
  
  let numSubClusters = 8;
  const maxIdx = Math.max(maxAssignedSubIdx, maxSubClusterIdx);
  if (maxIdx >= numSubClusters) {
    numSubClusters = maxIdx + 1;
  }

  let resolvedTargetSubIdx: number | null = null;
  if (subIdx !== null && subIdx !== undefined) {
    resolvedTargetSubIdx = subIdx;
  } else if (entityId) {
    const idx = clusterEntities.findIndex(e => e.id === entityId);
    if (idx !== -1) {
      resolvedTargetSubIdx = idx % numSubClusters;
    }
  }

  if (resolvedTargetSubIdx !== null) {
    const sc = subClusters.find(s => s.domain === domain && s.sub_idx === resolvedTargetSubIdx);
    if (sc && sc.x !== undefined && sc.x !== null && sc.y !== undefined && sc.y !== null) {
      return { x: sc.x + (Math.random() - 0.5) * 50, y: sc.y + (Math.random() - 0.5) * 50 };
    }
  }

  if (resolvedTargetSubIdx !== null) {
    const peers = clusterEntities.filter((e, idx) => {
      if (entityId && e.id === entityId) return false;
      const eSubIdx = (e.sub_idx !== null && e.sub_idx !== undefined && e.sub_idx < numSubClusters)
        ? e.sub_idx
        : idx % numSubClusters;
      return eSubIdx === resolvedTargetSubIdx;
    });

    if (peers.length > 0) {
      const avgX = peers.reduce((sum, p) => sum + p.x, 0) / peers.length;
      const avgY = peers.reduce((sum, p) => sum + p.y, 0) / peers.length;
      return { x: avgX + (Math.random() - 0.5) * 50, y: avgY + (Math.random() - 0.5) * 50 };
    }
  }

  const domainPeers = entities.filter(e => e.domain === domain && e.id !== entityId);
  if (domainPeers.length > 0) {
    const avgX = domainPeers.reduce((sum, p) => sum + p.x, 0) / domainPeers.length;
    const avgY = domainPeers.reduce((sum, p) => sum + p.y, 0) / domainPeers.length;
    return { x: avgX + (Math.random() - 0.5) * 50, y: avgY + (Math.random() - 0.5) * 50 };
  }
  
  return { x: 0, y: 0 };
};

export const useMapStore = create<MapState>((set) => ({

  entities: [],
  relationships: [],
  clusters: [],
  selectedEntityId: null,
  hoveredEntityId: null,
  searchQuery: '',
  zoomLevel: 1, // Default initial scale
  stageFilters: [],
  minRelevance: 0,
  selectedDomains: [],
  selectedTypes: [],
  selectedTags: [],
  excludedSubTags: [],
  viewMode: 'cluster',
  subClusters: [],
  isEditUnlocked: false,
  isConnectToolActive: false,
  connectLineStyle: 'solid',
  setConnectToolActive: (active) => set({ isConnectToolActive: active }),
  toggleConnectTool: () => set((state) => ({ isConnectToolActive: !state.isConnectToolActive })),
  setConnectLineStyle: (style) => set({ connectLineStyle: style }),
  
  setEntities: (entities) => {
    const mapped = entities.map(e => ({
      ...e,
      domain: normalizeDomain(e.domain),
      tags: e.tags?.map((t: string) => t === 'log' ? 'research' : t) || []
    }));
    set((state) => ({ entities: mapped, clusters: generateClusters(mapped, state.subClusters) }));
  },
  setRelationships: (relationships) => set({ relationships }),
  selectEntity: (id) => set((state) => {
    let updatedEntities = state.entities;
    if (id && state.viewMode === 'edit') {
      const target = state.entities.find(e => e.id === id);
      if (target && (target.is_new === 1 || target.is_new === true || (target.tags || []).some((t: string) => t === '🕳' || t === '#🕳') || target.stage === '🕳')) {
        fetch('/api/entities/clear-new-circle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        }).catch(err => console.error("Failed to clear new circle:", err));

        updatedEntities = state.entities.map(e => {
          if (e.id === id) {
            const newTags = (e.tags || []).filter((t: string) => t !== '🕳' && t !== '#🕳');
            const newStage = e.stage === '🕳' ? '' : e.stage;
            return { ...e, is_new: 0, tags: newTags, stage: newStage };
          }
          return e;
        });
      }
    }
    return { selectedEntityId: id, entities: updatedEntities };
  }),
  hoverEntity: (id) => set({ hoveredEntityId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  toggleStageFilter: (stage) => set((state) => ({
    stageFilters: state.stageFilters.includes(stage)
      ? state.stageFilters.filter(s => s !== stage)
      : [...state.stageFilters, stage]
  })),
  setMinRelevance: (relevance) => set({ minRelevance: relevance }),
  toggleDomainFilter: (domain) => set((state) => ({
    selectedDomains: state.selectedDomains.includes(domain)
      ? state.selectedDomains.filter(d => d !== domain)
      : [...state.selectedDomains, domain]
  })),
  toggleTypeFilter: (type) => set((state) => ({
    selectedTypes: state.selectedTypes.includes(type)
      ? state.selectedTypes.filter(t => t !== type)
      : [...state.selectedTypes, type]
  })),
  toggleTagFilter: (tag) => set((state) => ({
    selectedTags: state.selectedTags.includes(tag)
      ? state.selectedTags.filter(t => t !== tag)
      : [...state.selectedTags, tag]
  })),
  toggleSubTagExclude: (tag) => set((state) => ({
    excludedSubTags: state.excludedSubTags.includes(tag)
      ? state.excludedSubTags.filter(t => t !== tag)
      : [...state.excludedSubTags, tag]
  })),
  setViewMode: (mode) => set((state) => {
    let updatedEntities = state.entities;
    if (mode === 'edit' && state.selectedEntityId) {
      const id = state.selectedEntityId;
      const target = state.entities.find(e => e.id === id);
      if (target && (target.is_new === 1 || target.is_new === true || (target.tags || []).some((t: string) => t === '🕳' || t === '#🕳') || target.stage === '🕳')) {
        fetch('/api/entities/clear-new-circle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        }).catch(err => console.error("Failed to clear new circle:", err));

        updatedEntities = state.entities.map(e => {
          if (e.id === id) {
            const newTags = (e.tags || []).filter((t: string) => t !== '🕳' && t !== '#🕳');
            const newStage = e.stage === '🕳' ? '' : e.stage;
            return { ...e, is_new: 0, tags: newTags, stage: newStage };
          }
          return e;
        });
      }
    }
    return { viewMode: mode, entities: updatedEntities };
  }),
  setEditUnlocked: (unlocked) => {
    if (unlocked) {
      localStorage.setItem('isEditUnlocked', 'true');
    } else {
      localStorage.removeItem('isEditUnlocked');
    }
    set({ isEditUnlocked: unlocked });
  },
  setSubClusters: (subClusters) => set((state) => {
    const filtered = subClusters.filter(sc => !['metacrisis', 'sensemaking', 'knowledgemanagement', 'athlete'].includes(sc.domain.toLowerCase()));
    return { subClusters: filtered, clusters: generateClusters(state.entities, filtered) };
  }),
  updateSubClusterInStore: (domain, sub_idx, title, parent_sub_idx) => set((state) => ({
    subClusters: state.subClusters.some(sc => sc.domain === domain && sc.sub_idx === sub_idx)
      ? state.subClusters.map(sc => sc.domain === domain && sc.sub_idx === sub_idx ? { ...sc, title, ...(parent_sub_idx !== undefined ? { parent_sub_idx } : {}) } : sc)
      : [...state.subClusters, { domain, sub_idx, title, parent_sub_idx: parent_sub_idx ?? null }]
  })),
  deleteSubClusterInStore: (domain, targetSubIdx) => set((state) => {
    const target = state.subClusters.find(sc => sc.domain === domain && sc.sub_idx === targetSubIdx);
    const isTopLevel = !target || target.parent_sub_idx === null || target.parent_sub_idx === undefined;

    let newSubClusters = [...state.subClusters];

    if (!isTopLevel) {
      newSubClusters = newSubClusters.filter(sc => !(sc.domain === domain && sc.sub_idx === targetSubIdx));
    } else {
      newSubClusters = newSubClusters.filter(sc => {
        if (sc.domain !== domain) return true;
        if (sc.sub_idx === targetSubIdx) return false;
        if (sc.parent_sub_idx === targetSubIdx) return false;
        return true;
      });

      newSubClusters = newSubClusters.map(sc => {
        if (sc.domain !== domain) return sc;
        
        let newSubIdx = sc.sub_idx;
        let newParentSubIdx = sc.parent_sub_idx;

        if (sc.sub_idx > targetSubIdx) {
          newSubIdx = sc.sub_idx - 1;
        }

        if (sc.parent_sub_idx !== undefined && sc.parent_sub_idx !== null && sc.parent_sub_idx > targetSubIdx) {
          newParentSubIdx = sc.parent_sub_idx - 1;
        }

        let newTitle = sc.title;
        if (sc.sub_idx > targetSubIdx && /^SEC-0?\d+$/i.test(sc.title)) {
          newTitle = `SEC-0${newSubIdx + 1}`;
        }

        return {
          ...sc,
          sub_idx: newSubIdx,
          parent_sub_idx: newParentSubIdx,
          title: newTitle
        };
      });
    }

    const newEntities = state.entities.map(e => {
      if (e.domain !== domain) return e;
      if (e.sub_idx === targetSubIdx) {
        return { ...e, sub_idx: null };
      }
      if (e.sub_idx !== null && e.sub_idx !== undefined && e.sub_idx > targetSubIdx) {
        return { ...e, sub_idx: e.sub_idx - 1 };
      }
      return e;
    });

    return {
      subClusters: newSubClusters,
      entities: newEntities,
      clusters: generateClusters(newEntities, newSubClusters)
    };
  }),
  updateEntityCoordinatesInStore: (id, x, y, domain) => set((state) => {
    const updated = state.entities.map(e => e.id === id ? { ...e, x, y, ...(domain ? { domain } : {}) } : e);
    return {
      entities: updated,
      clusters: generateClusters(updated, state.subClusters)
    };
  }),
  updateEntityDomainInStore: (id, domain) => set((state) => {
    const updated = state.entities.map(e => e.id === id ? { ...e, domain } : e);
    return {
      entities: updated,
      clusters: generateClusters(updated, state.subClusters)
    };
  }),
  updateEntitySubClusterInStore: (id, sub_idx) => set((state) => {
    const updated = state.entities.map(e => e.id === id ? { ...e, sub_idx } : e);
    return {
      entities: updated
    };
  }),
  deleteEntityInStore: (id) => set((state) => {
    const updatedEntities = state.entities.filter(e => e.id !== id);
    const updatedRelationships = state.relationships.filter(r => r.source !== id && r.target !== id);
    return {
      entities: updatedEntities,
      relationships: updatedRelationships,
      clusters: generateClusters(updatedEntities, state.subClusters),
      selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId,
      hoveredEntityId: state.hoveredEntityId === id ? null : state.hoveredEntityId
    };
  }),
  renameClusterInStore: (oldDomain, newDomain) => set((state) => {
    const updatedEntities = state.entities.map(e => e.domain === oldDomain ? { ...e, domain: newDomain } : e);
    const updatedSubClusters = state.subClusters.map(sc => sc.domain === oldDomain ? { ...sc, domain: newDomain } : sc);
    return {
      entities: updatedEntities,
      subClusters: updatedSubClusters,
      clusters: generateClusters(updatedEntities, updatedSubClusters)
    };
  }),
  createClusterInStore: (domain) => set((state) => {
    if (state.subClusters.some(sc => sc.domain === domain)) return {};
    const updatedSubClusters = [...state.subClusters, { domain, sub_idx: 0, title: 'SEC-01' }];
    return {
      subClusters: updatedSubClusters,
      clusters: generateClusters(state.entities, updatedSubClusters)
    };
  }),
  clearAllFilters: () => set({
    stageFilters: [],
    minRelevance: 0,
    selectedDomains: [],
    selectedTypes: [],
    selectedTags: [],
    excludedSubTags: [],
    searchQuery: '',
  }),
}));

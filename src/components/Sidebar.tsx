import { useState, useEffect } from 'react';
import { useMapStore } from '../store';
import { Search, Map as MapIcon, RotateCcw, ChevronLeft, LayoutGrid, Trees, Network, Plus, Save, X, Edit, Lock, Link2, Trash2 } from 'lucide-react';
import { Entity } from '../types';

const STAGES = ['🕳', '🌱', '🌿', '🌲'];

const isStub = (e: Entity) => e.stage === 'stub' || e.stage === '🕳' || (e.type as string) === 'stub' || (e.tags && e.tags.includes('stub'));

const matchesStageFilter = (e: Entity, stageFilters: string[]) => {
  const entityIsStub = isStub(e);
  if (stageFilters.length > 0) {
    const hasStubFilter = stageFilters.includes('🕳');
    if (entityIsStub) {
      return hasStubFilter;
    } else {
      const otherFilters = stageFilters.filter(s => s !== '🕳');
      return otherFilters.includes(e.stage || '');
    }
  } else {
    return !entityIsStub;
  }
};

const ENTITY_TYPES = [
  { key: 'actors', label: '🎭  actors', tags: ['person', 'organization', 'community', 'network'] },
  { key: 'projects', label: '🛠  projects', tags: ['project', 'tool', 'prototype', 'experiment'] },
  { key: 'knowledge', label: '🧠  knowledge', tags: ['concept', 'framework', 'pattern', 'topic'] },
  { key: 'sources', label: '📚  sources', tags: ['article', 'book', 'paper', 'podcast', 'video', 'website', 'highlights', 'highlight'] },
  { key: 'original', label: '✨  original', tags: ['c4ss1us', 'l1f3'] },
];

const matchesTypes = (entityTags: string[], selectedTypes: string[], excludedSubTags: string[]): boolean => {
  if (selectedTypes.length === 0) return true;
  const normalized = (entityTags || []).map(t => t.replace(/^#/, '').toLowerCase());
  return selectedTypes.some(typeKey => {
    const typeDef = ENTITY_TYPES.find(t => t.key === typeKey);
    if (!typeDef) return false;
    return typeDef.tags.some(tag => normalized.includes(tag) && !excludedSubTags.includes(tag));
  });
};

const matchesTags = (entityTags: string[], selectedTags: string[]): boolean => {
  if (selectedTags.length === 0) return true;
  const normalized = (entityTags || []).map(t => t.replace(/^#/, '').toLowerCase());
  return selectedTags.every(st => normalized.includes(st.toLowerCase()));
};

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const [editingDomain, setEditingDomain] = useState<string>('research');
  const [isCreatingCluster, setIsCreatingCluster] = useState(false);
  const [newClusterName, setNewClusterName] = useState('');
  const [editingClusterName, setEditingClusterName] = useState('');

  const { 
    entities, selectEntity, searchQuery, setSearchQuery, 
    stageFilters, toggleStageFilter,
    minRelevance, setMinRelevance,
    selectedDomains, toggleDomainFilter,
    selectedTypes, toggleTypeFilter,
    selectedTags, toggleTagFilter,
    excludedSubTags, toggleSubTagExclude,
    clearAllFilters,
    clusters,
    viewMode, setViewMode,
    subClusters,
    renameClusterInStore,
    createClusterInStore,
    updateSubClusterInStore,
    deleteSubClusterInStore,
    isEditUnlocked, setEditUnlocked,
    isConnectToolActive, toggleConnectTool
  } = useMapStore();

  const [showPassModal, setShowPassModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passError, setPassError] = useState(false);

  useEffect(() => {
    if (viewMode === 'edit' && !isEditUnlocked) {
      setViewMode('cluster');
    }
  }, [viewMode, isEditUnlocked, setViewMode]);

  useEffect(() => {
    setEditingClusterName(editingDomain);
  }, [editingDomain]);

  const handleCreateCluster = async () => {
    const trimmed = newClusterName.trim().toLowerCase();
    if (!trimmed) return;
    
    createClusterInStore(trimmed);
    setEditingDomain(trimmed);
    
    try {
      await fetch('/api/clusters/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: trimmed })
      });
    } catch (e) {
      console.error("Failed to create cluster:", e);
    }
    
    setNewClusterName('');
    setIsCreatingCluster(false);
  };

  const handleRenameCluster = async () => {
    const trimmedNew = editingClusterName.trim().toLowerCase();
    const oldDomain = editingDomain;
    if (!trimmedNew || trimmedNew === oldDomain) return;
    
    renameClusterInStore(oldDomain, trimmedNew);
    setEditingDomain(trimmedNew);
    
    try {
      await fetch('/api/clusters/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldDomain, newDomain: trimmedNew })
      });
    } catch (e) {
      console.error("Failed to rename cluster:", e);
    }
  };

  const handleCreateSubCluster = async () => {
    const domain = editingDomain;
    if (!domain) return;
    
    const domainSubs = subClusters.filter(s => s.domain === domain && (s.parent_sub_idx === null || s.parent_sub_idx === undefined));
    const maxSubIdx = domainSubs.reduce((max: number, ds: any) => {
      return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
    }, -1);
    
    const domainEntities = entities.filter(e => e.domain === domain);
    const maxAssignedSubIdx = domainEntities.reduce((max: number, de: any) => {
      return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
    }, -1);
    
    const maxIdx = Math.max(maxSubIdx, maxAssignedSubIdx);
    const nextIdx = maxIdx + 1;
    const defaultTitle = `SEC-0${nextIdx + 1}`;
    
    try {
      const res = await fetch('/api/sub-clusters/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          parent_sub_idx: null,
          title: defaultTitle
        })
      });
      const data = await res.json();
      if (data.status === 'success' && data.sub_idx !== undefined) {
        updateSubClusterInStore(domain, data.sub_idx, defaultTitle, null);
      }
    } catch (err) {
      console.error("Failed to create sub-cluster:", err);
    }
  };

  const filteredEntities = entities.filter(e => {
    if (searchQuery && !e.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (!matchesStageFilter(e, stageFilters)) return false;
    if (e.relevance !== undefined && e.relevance < minRelevance) return false;
    if (selectedDomains.length > 0 && !selectedDomains.includes(e.domain)) return false;
    if (!matchesTypes(e.tags, selectedTypes, excludedSubTags)) return false;
    if (!matchesTags(e.tags, selectedTags)) return false;
    return true;
  });

  const hasAnyFilters = searchQuery !== '' || stageFilters.length > 0 || minRelevance > 0 || selectedDomains.length > 0 || selectedTypes.length > 0 || selectedTags.length > 0;

  return (
    <aside className="w-80 h-full bg-[#0a0c10]/60 border-r border-white/5 flex flex-col overflow-hidden z-10 flex-shrink-0 backdrop-blur-md">
      {/* Sticky Header with Search */}
      <div className="p-6 border-b border-white/5 flex flex-col gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search atlas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-9 pr-4 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Collapse Sidebar"
              className="p-1.5 rounded hover:bg-white/5 border border-white/5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer flex-shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
        
        {hasAnyFilters && (
          <button 
            onClick={clearAllFilters}
            className="flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-widest transition-colors w-fit"
          >
            <RotateCcw className="w-3 h-3" />
            Clear All Filters
          </button>
        )}
      </div>

      {/* Scrollable Body containing both Filters & Index */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        
        {/* Map View Mode */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Map View Mode</span>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setViewMode('cluster')}
              title="Cluster Map"
              className={`w-7 h-7 rounded flex items-center justify-center border transition-colors cursor-pointer ${viewMode === 'cluster' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('darkforest')}
              title="Dark Forest View"
              className={`w-7 h-7 rounded flex items-center justify-center border transition-colors cursor-pointer ${viewMode === 'darkforest' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`}
            >
              <Trees className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('graph')}
              title="Relationship Graph"
              className={`w-7 h-7 rounded flex items-center justify-center border transition-colors cursor-pointer ${viewMode === 'graph' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`}
            >
              <Network className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (isEditUnlocked) {
                  setViewMode('edit');
                } else {
                  setShowPassModal(true);
                }
              }}
              title={isEditUnlocked ? "Edit Mode" : "Unlock Edit Mode (Passphrase Required)"}
              className={`w-7 h-7 rounded flex items-center justify-center border transition-colors cursor-pointer ${viewMode === 'edit' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'} relative`}
            >
              <Edit className="w-3.5 h-3.5" />
              {!isEditUnlocked && (
                <Lock className="w-1.5 h-1.5 absolute bottom-0.5 right-0.5 text-slate-400" />
              )}
            </button>
            
            {/* Connect Tool (Half size icon: w-4 h-4 button with w-2.5 h-2.5 icon) */}
            <button
              onClick={() => {
                if (!isEditUnlocked) {
                  setShowPassModal(true);
                  return;
                }
                if (viewMode !== 'edit') {
                  setViewMode('edit');
                }
                toggleConnectTool();
              }}
              title={isConnectToolActive ? "Connect Tool (Active - Click to disable)" : "Connect Tool (Create Link)"}
              className={`w-4 h-4 rounded flex items-center justify-center border transition-all cursor-pointer ${
                isConnectToolActive && viewMode === 'edit'
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-500/50 ring-1 ring-indigo-300'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
            >
              <Link2 className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>

        {/* Stage Filter */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Stage</span>
          <div className="flex gap-2">
            {STAGES.map(stage => (
              <button 
                key={stage}
                onClick={() => toggleStageFilter(stage)}
                className={`w-7 h-7 text-xs rounded flex items-center justify-center border transition-colors ${stageFilters.includes(stage) ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
              >
                {stage}
              </button>
            ))}
          </div>
        </div>

        {/* Min Relevance Slider */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Min Relevance</span>
            <span className="text-[10px] font-mono text-indigo-400">{minRelevance}</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={minRelevance}
            onChange={(e) => setMinRelevance(Number(e.target.value))}
            className="w-full accent-indigo-500 bg-white/5 h-1 rounded-lg cursor-pointer"
          />
        </div>

        {/* Type Filter */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Types</span>
          <div className="flex flex-col gap-1.5">
            {ENTITY_TYPES.map(type => {
              const isSelected = selectedTypes.includes(type.key);
              return (
                <div key={type.key} className="flex flex-wrap items-center gap-1.5">
                  <button 
                    onClick={() => toggleTypeFilter(type.key)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${isSelected ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/10'}`}
                  >
                    {type.label}
                  </button>
                  
                  {/* Render sub-tags if selected */}
                  {isSelected && (
                    <div className="flex flex-wrap gap-1 items-center">
                      {type.tags.map(tag => {
                        const isExcluded = excludedSubTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => toggleSubTagExclude(tag)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-all flex items-center gap-0.5 ${!isExcluded ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20' : 'bg-white/5 border-white/5 text-slate-600 hover:text-slate-400'}`}
                            title={!isExcluded ? `Exclude #${tag}` : `Include #${tag}`}
                          >
                            <span>#{tag}</span>
                            {!isExcluded ? (
                              <span className="text-indigo-400 font-bold">✓</span>
                            ) : (
                              <span className="text-slate-600 font-bold">×</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Domains Filter */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Domains</span>
          <div className="flex flex-wrap gap-1.5">
            {clusters.map(cluster => (
              <button 
                key={cluster.name}
                onClick={() => toggleDomainFilter(cluster.name)}
                className={`px-2.5 py-1 rounded text-[10px] font-mono border transition-colors uppercase ${selectedDomains.includes(cluster.name) ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:bg-white/10'}`}
              >
                {cluster.name}
              </button>
            ))}
          </div>
        </div>

        {/* Sector Titles Editor */}
        {viewMode === 'edit' && (
          <div className="pt-6 border-t border-white/5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Clusters & Sectors</span>
              <button
                onClick={handleCreateSubCluster}
                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 uppercase tracking-wider cursor-pointer font-sans"
                title="Create new sub-cluster"
              >
                <Plus className="w-3 h-3" /> Create New
              </button>
            </div>
            
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-slate-500 font-mono">SELECT CLUSTER</span>
              <select 
                value={editingDomain}
                onChange={(e) => setEditingDomain(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 transition-colors cursor-pointer font-sans"
              >
                {clusters.map(c => (
                  <option key={c.name} value={c.name} className="bg-[#0f1115] text-slate-300 font-sans">
                    {c.name.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Rename Selected Cluster */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-slate-500 font-mono">RENAME SELECTED CLUSTER</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={editingClusterName}
                  onChange={(e) => setEditingClusterName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRenameCluster()}
                  className="flex-1 bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 font-sans"
                  placeholder="Rename cluster..."
                />
                {editingClusterName !== editingDomain && (
                  <button
                    onClick={handleRenameCluster}
                    className="px-2.5 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/30 text-indigo-300 rounded text-xs font-bold transition-all flex items-center gap-1 cursor-pointer font-sans"
                    title="Save new cluster name"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                )}
              </div>
            </div>
            
            {(() => {
              const domainEntities = entities.filter(e => e.domain === editingDomain);
              const maxAssignedSubIdx = domainEntities.reduce((max: number, de: any) => {
                return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
              }, -1);
              
              const domainSubs = subClusters.filter(s => s.domain === editingDomain && (s.parent_sub_idx === null || s.parent_sub_idx === undefined));
              const maxSubClusterIdx = domainSubs.reduce((max: number, ds: any) => {
                return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
              }, -1);
              
              let numSubClusters = 8;
              const maxIdx = Math.max(maxAssignedSubIdx, maxSubClusterIdx);
              if (maxIdx >= numSubClusters) {
                numSubClusters = maxIdx + 1;
              }
              
              const subIndices = Array.from({ length: numSubClusters }, (_, i) => i);
              
              const uniqueTopLevelSubs = [...subIndices.map(subIdx => {
                const existing = subClusters.find(s => s.domain === editingDomain && s.sub_idx === subIdx);
                if (existing) {
                  return existing;
                }
                return {
                  domain: editingDomain,
                  sub_idx: subIdx,
                  title: `SEC-0${subIdx + 1}`,
                  parent_sub_idx: null
                };
              }), ...subClusters.filter(s => s.domain === editingDomain && (s.parent_sub_idx === null || s.parent_sub_idx === undefined) && !subIndices.includes(s.sub_idx))].filter((item, index, self) =>
                self.findIndex(t => t.sub_idx === item.sub_idx) === index
              );

              if (uniqueTopLevelSubs.length === 0) {
                return <div className="text-[11px] text-slate-600 italic">No sub-sectors in this cluster.</div>;
              }

              const handleCreateSubSubCluster = async (domain: string, parentSubIdx: number) => {
                const parentSc = subClusters.find(s => s.domain === domain && s.sub_idx === parentSubIdx);
                const parentTitle = parentSc ? parentSc.title : `SEC-0${parentSubIdx + 1}`;
                const defaultTitle = `${parentTitle} Sub`;
                
                try {
                  const res = await fetch('/api/sub-clusters/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      domain,
                      parent_sub_idx: parentSubIdx,
                      title: defaultTitle
                    })
                  });
                  const data = await res.json();
                  if (data.status === 'success' && data.sub_idx !== undefined) {
                    updateSubClusterInStore(domain, data.sub_idx, defaultTitle, parentSubIdx);
                  }
                } catch (err) {
                  console.error("Failed to create sub-sub-cluster:", err);
                }
              };

              const handleDeleteSubCluster = async (domain: string, targetSubIdx: number) => {
                deleteSubClusterInStore(domain, targetSubIdx);
                try {
                  await fetch('/api/sub-clusters/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ domain, sub_idx: targetSubIdx })
                  });
                } catch (err) {
                  console.error("Failed to delete sub-cluster:", err);
                }
              };

              return (
                <div className="flex flex-col gap-3 mt-1">
                  {uniqueTopLevelSubs.map(parentSc => {
                    const subIdx = parentSc.sub_idx;
                    const children = subClusters.filter(s => s.domain === editingDomain && s.parent_sub_idx === subIdx);
                    
                    return (
                      <div key={subIdx} className="flex flex-col gap-1 border-b border-white/[0.02] pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between text-[9px] text-slate-600 font-mono">
                          <span>SUB-CLUSTER 0{subIdx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCreateSubSubCluster(editingDomain, subIdx)}
                              className="p-1 hover:bg-white/10 rounded text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                              title="Add sub-sub-cluster"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteSubCluster(editingDomain, subIdx)}
                              className="p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                              title={`Delete SUB-CLUSTER 0${subIdx + 1}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <input 
                          type="text"
                          value={parentSc.title}
                          onChange={async (e) => {
                            const newTitle = e.target.value;
                            updateSubClusterInStore(editingDomain, subIdx, newTitle);
                            
                            try {
                              await fetch('/api/sub-clusters/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  domain: editingDomain,
                                  sub_idx: subIdx,
                                  title: newTitle
                                })
                              });
                            } catch (err) {
                              console.error("Failed to save sub-cluster title:", err);
                            }
                          }}
                          className="bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-colors"
                          placeholder={`Name SEC-0${subIdx + 1}...`}
                        />

                        {children.length > 0 && (
                          <div className="flex flex-col gap-1.5 mt-1.5 pl-4 border-l border-white/5">
                            {children.map(child => (
                              <div key={child.sub_idx} className="flex flex-col gap-1">
                                <div className="flex items-center justify-between text-[8px] text-slate-600 font-mono">
                                  <span>↳ SUB-SUB-CLUSTER</span>
                                  <button
                                    onClick={() => handleDeleteSubCluster(editingDomain, child.sub_idx)}
                                    className="p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                                    title="Delete sub-sub-cluster"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                                <input 
                                  type="text"
                                  value={child.title}
                                  onChange={async (e) => {
                                    const newTitle = e.target.value;
                                    updateSubClusterInStore(editingDomain, child.sub_idx, newTitle, subIdx);
                                    
                                    try {
                                      await fetch('/api/sub-clusters/update', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          domain: editingDomain,
                                          sub_idx: child.sub_idx,
                                          title: newTitle
                                        })
                                      });
                                    } catch (err) {
                                      console.error("Failed to save sub-sub-cluster title:", err);
                                    }
                                  }}
                                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-colors"
                                  placeholder="Name sub-sub-cluster..."
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Index section */}
        <div className="pt-6 border-t border-white/5 flex flex-col gap-4">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pb-1">Index ({filteredEntities.length} Nodes)</h3>
          
          {entities.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center text-slate-600 py-6 space-y-4">
              <MapIcon className="w-12 h-12 text-white/5" />
              <p className="text-xs tracking-wide">Syncing repository... No nodes found.</p>
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-4">No nodes match filters.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredEntities
                .slice(0, 100)
                .map(entity => (
                <button
                  key={entity.id}
                  onClick={() => selectEntity(entity.id)}
                  className="text-left px-3 py-2 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors truncate flex items-center justify-between"
                >
                  <span className="truncate">{entity.title}</span>
                  {entity.stage && (
                    <span className="ml-2 text-xs flex-shrink-0">
                      {entity.stage === 'stub' ? '🕳' : entity.stage}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {showPassModal && (
        <div className="fixed inset-0 bg-[#050608]/90 backdrop-blur-md z-50 flex items-center justify-center transition-all animate-fade-in">
          <div className="bg-[#0f1115] border border-white/10 p-6 rounded-lg max-w-sm w-full mx-4 flex flex-col gap-4 shadow-2xl relative">
            <button 
              onClick={() => {
                setShowPassModal(false);
                setPassError(false);
                setPasswordInput('');
              }}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer border-0 bg-transparent p-0"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-col gap-1 text-center">
              <span className="text-xs font-mono text-indigo-400 uppercase tracking-widest flex items-center justify-center gap-1.5 mb-1">
                <Lock className="w-3.5 h-3.5 animate-pulse" /> Architect Authorization
              </span>
              <h3 className="text-lg font-sans font-medium text-slate-100">Unlock Edit Mode</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Enter the gardener passphrase to enable coordinate re-alignment, renaming, and custom sector layout tools.</p>
            </div>
            <div className="flex flex-col gap-2">
              <input
                type="password"
                placeholder="Passphrase"
                autoFocus
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  setPassError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (passwordInput === 'c4ss.garden') {
                      setEditUnlocked(true);
                      setShowPassModal(false);
                      setViewMode('edit');
                      setPassError(false);
                      setPasswordInput('');
                    } else {
                      setPassError(true);
                    }
                  }
                }}
                className={`w-full bg-white/5 border rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-colors text-center font-mono ${passError ? 'border-red-500/50' : 'border-white/10'}`}
              />
              {passError && <span className="text-[10px] text-red-400 text-center font-mono animate-pulse">Incorrect passphrase</span>}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setShowPassModal(false);
                  setPassError(false);
                  setPasswordInput('');
                }}
                className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 rounded text-xs font-bold transition-all cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (passwordInput === 'c4ss.garden') {
                    setEditUnlocked(true);
                    setShowPassModal(false);
                    setViewMode('edit');
                    setPassError(false);
                    setPasswordInput('');
                  } else {
                    setPassError(true);
                  }
                }}
                className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition-all cursor-pointer font-sans"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

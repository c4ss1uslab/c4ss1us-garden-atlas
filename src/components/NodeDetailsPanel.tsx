import ReactMarkdown from 'react-markdown';
import { useMapStore, calculateNewNodeCoordinates } from '../store';
import { X, ExternalLink, FileText, Brain, Sparkles } from 'lucide-react';
import { useState, useMemo } from 'react';

const ENTITY_TYPES = [
  { key: 'actors', label: 'actors', tags: ['person', 'organization', 'community', 'network'] },
  { key: 'projects', label: 'projects', tags: ['project', 'tool', 'prototype', 'experiment'] },
  { key: 'knowledge', label: 'knowledge', tags: ['concept', 'framework', 'pattern', 'topic'] },
  { key: 'sources', label: 'sources', tags: ['article', 'book', 'paper', 'podcast', 'video', 'website'] },
  { key: 'original', label: 'original', tags: ['c4ss1us', 'l1f3'] },
];

const getSpecificType = (entity: any) => {
  if (!entity || !entity.tags) return null;
  const normalizedTags = entity.tags.map((t: string) => t.replace(/^#/, '').toLowerCase().trim());
  
  const category = ENTITY_TYPES.find(cat => cat.key === entity.type);
  if (!category) return null;
  
  const matchedTag = category.tags.find(tag => normalizedTags.includes(tag));
  return matchedTag || null;
};

const getEntitySubCluster = (entity: any, allEntities: any[], subClusters: any[]) => {
  if (!entity) return null;
  const clusterEntities = allEntities
    .filter(e => e.domain === entity.domain)
    .sort((a, b) => a.id.localeCompare(b.id));
    
  const maxAssignedSubIdx = clusterEntities.reduce((max: number, de: any) => {
    return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
  }, -1);
  
  const domainSubs = subClusters.filter(s => s.domain === entity.domain);
  const maxSubClusterIdx = domainSubs.reduce((max: number, ds: any) => {
    return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
  }, -1);
  
  let numSubClusters = 8;
  const maxIdx = Math.max(maxAssignedSubIdx, maxSubClusterIdx);
  if (maxIdx >= numSubClusters) {
    numSubClusters = maxIdx + 1;
  }
  
  if (numSubClusters === 0) return null;
  
  const idx = clusterEntities.findIndex(e => e.id === entity.id);
  if (idx === -1) return null;
  
  const subIdx = (entity.sub_idx !== null && entity.sub_idx !== undefined && entity.sub_idx < numSubClusters)
    ? entity.sub_idx
    : idx % numSubClusters;
    
  const sc = subClusters.find(s => s.domain === entity.domain && s.sub_idx === subIdx);
  if (!sc) return { subIdx, title: `SEC-0${subIdx + 1}` };

  if (sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined) {
    const parentSc = subClusters.find(s => s.domain === entity.domain && s.sub_idx === sc.parent_sub_idx);
    const parentTitle = parentSc ? parentSc.title : `SEC-0${sc.parent_sub_idx + 1}`;
    return {
      subIdx,
      title: `${parentTitle} ↳ ${sc.title}`
    };
  }

  return {
    subIdx,
    title: sc.title
  };
};

export default function NodeDetailsPanel() {
  const { entities, selectedEntityId, selectEntity, toggleTagFilter, selectedTags, clusters, subClusters, updateEntityDomainInStore, updateEntitySubClusterInStore, updateEntityCoordinatesInStore, viewMode } = useMapStore();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDomainDropdownOpen, setIsDomainDropdownOpen] = useState(false);
  const [isSubClusterDropdownOpen, setIsSubClusterDropdownOpen] = useState(false);
  
  const entity = useMemo(() => {
    return entities.find(e => e.id === selectedEntityId) || null;
  }, [entities, selectedEntityId]);

  const clusterColor = useMemo(() => {
    if (!entity) return '#6366f1';
    const cluster = clusters.find(c => c.name === entity.domain);
    return cluster ? cluster.color : '#6366f1';
  }, [entity, clusters]);

  const subClusterInfo = useMemo(() => {
    return getEntitySubCluster(entity, entities, subClusters);
  }, [entity, entities, subClusters]);

  const availableSubClusters = useMemo(() => {
    if (!entity) return [];
    const clusterEntities = entities
      .filter(e => e.domain === entity.domain)
      .sort((a, b) => a.id.localeCompare(b.id));
      
    const maxAssignedSubIdx = clusterEntities.reduce((max: number, de: any) => {
      return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
    }, -1);
    
    const domainSubs = subClusters.filter(s => s.domain === entity.domain);
    const maxSubClusterIdx = domainSubs.reduce((max: number, ds: any) => {
      return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
    }, -1);
    
    let numSubClusters = 8;
    const maxIdx = Math.max(maxAssignedSubIdx, maxSubClusterIdx);
    if (maxIdx >= numSubClusters) {
      numSubClusters = maxIdx + 1;
    }
    
    const list: Array<{ sub_idx: number; title: string }> = [];
    const addedIndices = new Set<number>();

    for (let i = 0; i < numSubClusters; i++) {
      const sc = subClusters.find(s => s.domain === entity.domain && s.sub_idx === i);
      if (!sc) {
        if (!addedIndices.has(i)) {
          list.push({ sub_idx: i, title: `SEC-0${i + 1}` });
          addedIndices.add(i);
        }
      } else if (sc.parent_sub_idx === null || sc.parent_sub_idx === undefined) {
        if (!addedIndices.has(i)) {
          list.push({ sub_idx: i, title: sc.title });
          addedIndices.add(i);
        }
        // Append child sub-sub-clusters under this parent
        const children = subClusters.filter(s => s.domain === entity.domain && s.parent_sub_idx === i);
        children.forEach(ch => {
          if (!addedIndices.has(ch.sub_idx)) {
            list.push({ sub_idx: ch.sub_idx, title: `  ↳ ${ch.title}` });
            addedIndices.add(ch.sub_idx);
          }
        });
      }
    }

    // Include any child sub-clusters whose parent_sub_idx was not caught
    subClusters.forEach(sc => {
      if (sc.domain === entity.domain && sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined) {
        if (!addedIndices.has(sc.sub_idx)) {
          list.push({ sub_idx: sc.sub_idx, title: `  ↳ ${sc.title}` });
          addedIndices.add(sc.sub_idx);
        }
      }
    });

    return list;
  }, [entity, entities, subClusters]);

  const specificType = useMemo(() => {
    return getSpecificType(entity);
  }, [entity]);

  const resolveEntity = (target: string) => {
    const cleanTarget = target.trim().toLowerCase().replace(/\\/g, '');
    const targetFile = cleanTarget.split('/').pop() || '';
    
    return entities.find(e => {
      const eTitle = e.title.trim().toLowerCase();
      // 1. Direct title match
      if (eTitle === cleanTarget) return true;
      // 2. Filename part match
      if (eTitle === targetFile) return true;
      // 3. Permalink match (slugified)
      const slugifiedTitle = eTitle.replace(/[^a-z0-9]+/g, '-');
      const slugifiedTarget = targetFile.replace(/[^a-z0-9]+/g, '-');
      if (slugifiedTitle === slugifiedTarget) return true;
      return false;
    });
  };

  const handleClusterChange = async (newDomain: string) => {
    setIsDomainDropdownOpen(false);
    if (!entity) return;
    
    const newCoords = calculateNewNodeCoordinates(entities, subClusters, newDomain, entity.sub_idx, entity.id);
    updateEntityCoordinatesInStore(entity.id, newCoords.x, newCoords.y, newDomain);
    
    try {
      await fetch('/api/entities/update-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entity.id,
          domain: newDomain,
          x: newCoords.x,
          y: newCoords.y
        })
      });
      showToast(`Moved node to cluster "${newDomain}"`);
    } catch (e) {
      console.error("Failed to update entity domain:", e);
      showToast("Error updating node cluster.");
    }
  };

  const handleSubClusterChange = async (newSubIdx: number) => {
    setIsSubClusterDropdownOpen(false);
    if (!entity) return;
    
    const newCoords = calculateNewNodeCoordinates(entities, subClusters, entity.domain, newSubIdx, entity.id);
    updateEntitySubClusterInStore(entity.id, newSubIdx);
    updateEntityCoordinatesInStore(entity.id, newCoords.x, newCoords.y);
    
    try {
      await fetch('/api/entities/update-subcluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entity.id,
          sub_idx: newSubIdx,
          x: newCoords.x,
          y: newCoords.y
        })
      });
      const scName = availableSubClusters.find(sc => sc.sub_idx === newSubIdx)?.title || `SEC-0${newSubIdx + 1}`;
      showToast(`Moved node to sub-cluster "${scName}"`);
    } catch (e) {
      console.error("Failed to update entity sub-cluster:", e);
      showToast("Error updating node sub-cluster.");
    }
  };

  interface ExtractedLink {
    label: string;
    url: string;
    isInternal: boolean;
    isMissing?: boolean;
  }

  const linksInFile = useMemo((): ExtractedLink[] => {
    if (!entity) return [];
    const content = entity.content || '';
    const links: ExtractedLink[] = [];
    const seenUrls = new Set<string>();

    // 1. Wikilinks
    const wikiRegex = /\[\[(.*?)\]\]/g;
    let match;
    while ((match = wikiRegex.exec(content)) !== null) {
      const inner = match[1];
      const parts = inner.split('|');
      const targetName = parts[0].trim();
      const alias = parts.length > 1 ? parts[1].trim() : targetName;
      
      const targetEntity = resolveEntity(targetName);
      if (targetEntity) {
        const url = `wiki://${targetEntity.id}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          links.push({
            label: alias || targetEntity.title,
            url,
            isInternal: true
          });
        }
      } else {
        const url = `missing-wiki://${encodeURIComponent(targetName)}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const displayLabel = alias.split('/').pop() || alias;
          links.push({
            label: displayLabel,
            url,
            isInternal: true,
            isMissing: true
          });
        }
      }
    }

    // 2. Markdown external links: [Label](URL) where URL is not starting with wiki:// or missing-wiki://
    const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    while ((match = mdLinkRegex.exec(content)) !== null) {
      const label = match[1].trim();
      const url = match[2].trim();
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        links.push({
          label,
          url,
          isInternal: false
        });
      }
    }

    // 3. Raw URLs (excluding those already in markdown links)
    const rawUrlRegex = /(?<!\()https?:\/\/[^\s\)\],]+/g;
    while ((match = rawUrlRegex.exec(content)) !== null) {
      const url = match[0].trim();
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        links.push({
          label: url,
          url,
          isInternal: false
        });
      }
    }

    return links;
  }, [entity, entities]);

  if (!selectedEntityId || !entity) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const processContent = (content: string) => {
    // Strip frontmatter
    let processed = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    
    // Process wikilinks
    processed = processed.replace(/\[\[(.*?)\]\]/g, (match, inner) => {
      const parts = inner.split('|');
      const targetName = parts[0];
      const alias = parts.length > 1 ? parts[1] : targetName;
      
      const targetEntity = resolveEntity(targetName);
      if (targetEntity) {
        return `[${alias}](wiki://${targetEntity.id})`;
      } else {
        return `[${alias}](missing-wiki://${encodeURIComponent(targetName)})`;
      }
    });

    if (processed.length > 600) {
      processed = processed.substring(0, 600) + '...';
    }

    return processed;
  };

  const fullUrl = entity.permalink ? `https://c4ss1usgarden.vercel.app${entity.permalink.startsWith('/') ? '' : '/'}${entity.permalink}` : null;

  return (
    <div className="w-[450px] h-full bg-[#0a0c10] border-l border-white/10 flex flex-col shadow-2xl flex-shrink-0 z-10 transition-transform relative">
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-800 text-slate-200 text-xs px-3 py-1.5 rounded shadow-lg border border-slate-700 z-50 whitespace-nowrap">
          {toastMessage}
        </div>
      )}
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3 truncate">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6366f1' }}></div>
          <span className="text-sm font-bold text-slate-200 truncate">{entity.title}</span>
        </div>
        <button 
          onClick={() => selectEntity(null)}
          className="p-1.5 rounded hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 text-slate-300">
        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
            {/* Continent / Domain with Dropdown if edit mode, else static badge */}
            {viewMode === 'edit' ? (
              <div className="relative inline-block text-left">
                <button 
                  onClick={() => setIsDomainDropdownOpen(!isDomainDropdownOpen)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono border uppercase cursor-pointer flex items-center gap-1 transition-all hover:bg-white/10 animate-fade-in"
                  style={{
                    backgroundColor: `${clusterColor}15`,
                    color: clusterColor,
                    borderColor: `${clusterColor}30`
                  }}
                  title="Change node's cluster"
                >
                  <span>{entity.domain}</span>
                  <span className="text-[8px] opacity-70">▼</span>
                </button>

                {isDomainDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsDomainDropdownOpen(false)}
                    />
                    <div className="absolute top-full mt-1.5 left-0 bg-[#0f1115] border border-white/15 rounded shadow-xl z-50 py-1.5 min-w-[160px] max-h-[220px] overflow-y-auto">
                      <div className="px-2.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-white/5 mb-1">
                        Move to Domain/Cluster
                      </div>
                      {clusters.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => handleClusterChange(c.name)}
                          className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors flex items-center gap-2 ${entity.domain === c.name ? 'text-indigo-400 bg-white/5 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                          <span>{c.name.toUpperCase()}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <span 
                className="px-2 py-0.5 rounded text-[10px] font-mono border uppercase"
                style={{
                  backgroundColor: `${clusterColor}15`,
                  color: clusterColor,
                  borderColor: `${clusterColor}30`
                }}
              >
                {entity.domain}
              </span>
            )}

            {/* Sub-cluster with Dropdown if edit mode, else static badge */}
            {subClusterInfo && (
              viewMode === 'edit' ? (
                <div className="relative inline-block text-left">
                  <button 
                    onClick={() => setIsSubClusterDropdownOpen(!isSubClusterDropdownOpen)}
                    className="px-2 py-0.5 rounded text-[10px] font-mono border uppercase cursor-pointer flex items-center gap-1 transition-all hover:bg-white/10"
                    style={{
                      backgroundColor: `${clusterColor}15`,
                      color: clusterColor,
                      borderColor: `${clusterColor}30`
                    }}
                    title="Change node's sub-cluster"
                  >
                    <span>{subClusterInfo.title}</span>
                    <span className="text-[8px] opacity-70">▼</span>
                  </button>

                  {isSubClusterDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsSubClusterDropdownOpen(false)}
                      />
                      <div className="absolute top-full mt-1.5 left-0 bg-[#0f1115] border border-white/15 rounded shadow-xl z-50 py-1.5 min-w-[160px] max-h-[220px] overflow-y-auto">
                        <div className="px-2.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-white/5 mb-1">
                          Move to Sub-cluster
                        </div>
                        {availableSubClusters.map((sc) => (
                          <button
                            key={sc.sub_idx}
                            onClick={() => handleSubClusterChange(sc.sub_idx)}
                            className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors flex items-center gap-2 ${subClusterInfo.subIdx === sc.sub_idx ? 'text-indigo-400 bg-white/5 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: clusterColor }} />
                            <span>{sc.title}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span 
                  className="px-2 py-0.5 rounded text-[10px] font-mono border uppercase"
                  style={{
                    backgroundColor: `${clusterColor}15`,
                    color: clusterColor,
                    borderColor: `${clusterColor}30`
                  }}
                >
                  {subClusterInfo.title}
                </span>
              )
            )}

            {/* Level */}
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-slate-400 border border-white/10 uppercase">
                {entity.scale}
            </span>

            {/* Type */}
            {specificType && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
                  {specificType}
              </span>
            )}
        </div>

        {/* Tags Row */}
        <div className="flex flex-wrap gap-1.5 mb-5 border-t border-white/5 pt-3">
            {entity.tags && entity.tags
              .filter(t => t !== entity.domain && t.replace(/^#/, '').toLowerCase() !== specificType)
              .map((tag, idx) => {
                const normalizedTag = tag.replace(/^#/, '').toLowerCase();
                const isSelected = selectedTags.includes(normalizedTag);
                return (
                    <button 
                        key={idx} 
                        onClick={() => toggleTagFilter(normalizedTag)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border uppercase transition-colors ${isSelected ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300 font-bold' : 'bg-white/5 text-slate-500 border-white/10 hover:text-slate-300 hover:bg-white/10'}`}
                    >
                        #{tag.replace(/^#/, '')}
                    </button>
                );
            })}
        </div>

        {/* Relevance Score Section */}
        <div className="mb-4 p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Relevance Score</span>
            <span className="text-xs font-mono font-bold text-indigo-400">{entity.relevance ?? 0}%</span>
          </div>
          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
            <div 
              className="bg-indigo-500 h-full rounded-full transition-all duration-500" 
              style={{ width: `${entity.relevance ?? 0}%` }}
            />
          </div>
        </div>

        {/* Hyperlinks Section */}
        {linksInFile.length > 0 && (
          <div className="mb-6 p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono block mb-2">
              Hyperlinks in File ({linksInFile.length})
            </span>
            <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
              {linksInFile.slice(0, 8).map((link, idx) => {
                if (link.isInternal) {
                  if (link.isMissing) {
                    return (
                      <button
                        key={idx}
                        onClick={() => showToast(`This note wasn't created yet.`)}
                        className="flex items-center gap-2 text-left text-xs text-slate-500 hover:text-slate-400 transition-colors truncate"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                        <span className="truncate">{link.label}</span>
                        <span className="text-[9px] font-mono text-slate-600">(missing)</span>
                      </button>
                    );
                  }
                  const targetId = link.url.replace('wiki://', '');
                  return (
                    <button
                      key={idx}
                      onClick={() => selectEntity(targetId)}
                      className="flex items-center gap-2 text-left text-xs text-indigo-400 hover:text-indigo-300 transition-colors truncate"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-400/70 flex-shrink-0" />
                      <span className="truncate font-medium">{link.label}</span>
                    </button>
                  );
                } else {
                  return (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-left text-xs text-amber-400 hover:text-amber-300 transition-colors truncate"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-amber-500/70 flex-shrink-0" />
                      <span className="truncate">{link.label}</span>
                    </a>
                  );
                }
              })}
              {linksInFile.length > 8 && (
                <div className="text-[10px] font-mono text-slate-600 pl-5 pt-0.5">
                  + {linksInFile.length - 8} more links
                </div>
              )}
            </div>
          </div>
        )}

        {/* Markdown Content */}
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-200 prose-a:text-indigo-400 hover:prose-a:text-indigo-300 prose-code:text-amber-400 prose-code:bg-white/5 prose-code:px-1 prose-code:rounded">
          <ReactMarkdown
            components={{
              a: ({ node, href, children, ...props }) => {
                if (href?.startsWith('wiki://')) {
                  const targetId = href.replace('wiki://', '');
                  return (
                    <a 
                      href="#" 
                      onClick={(e) => { e.preventDefault(); selectEntity(targetId); }}
                      className="text-indigo-400 hover:text-indigo-300 no-underline border-b border-indigo-400/30 transition-colors"
                    >
                      {children}
                    </a>
                  );
                } else if (href?.startsWith('missing-wiki://')) {
                  const name = decodeURIComponent(href.replace('missing-wiki://', ''));
                  return (
                    <a 
                      href="#" 
                      onClick={(e) => { e.preventDefault(); showToast(`This note wasn't created yet.`); }}
                      className="text-slate-500 hover:text-slate-400 no-underline border-b border-slate-500/30 cursor-help transition-colors"
                    >
                      {children}
                    </a>
                  );
                }
                return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
              }
            }}
          >
            {processContent(entity.content || '*No content available for this node.*')}
          </ReactMarkdown>
        </div>
      </div>

      {/* Sticky Footer for Read full article */}
      {fullUrl && (
        <div className="p-4 border-t border-white/10 bg-[#0c0e12] flex-shrink-0">
          <a 
            href={fullUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 py-3 rounded border border-indigo-500/20 transition-all shadow-lg hover:shadow-indigo-500/5"
          >
            Read full page on Digital Garden
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}

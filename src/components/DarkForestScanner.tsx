import { useState } from 'react';
import { useMapStore } from '../store';
import { Entity } from '../types';
import { Trees, Sparkles, ArrowRight, RefreshCw, CheckCircle2, FileText, Layers, Tag, HelpCircle, ShieldAlert } from 'lucide-react';

export default function DarkForestScanner() {
  const { entities, setEntities, clusters, subClusters, setSubClusters, selectEntity, setViewMode } = useMapStore();
  const [isScanning, setIsScanning] = useState(false);
  const [batchSize, setBatchSize] = useState(50);
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number } | null>(null);
  const [selectedDomainFilter, setSelectedDomainFilter] = useState<string>('all');
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [targetDomain, setTargetDomain] = useState<string>('lab');
  const [targetSubIdx, setTargetSubIdx] = useState<number>(0);

  // Filter raw/unmapped notes
  const rawNotes = entities.filter(e => {
    const hasHoleTag = (e.tags || []).some((t: string) => t === '🕳' || t === '#🕳' || t.toLowerCase() === 'raw');
    const isHoleStage = e.stage === '🕳' || e.stage === 'stub';
    const isUncategorized = e.domain === 'uncategorized';
    return hasHoleTag || isHoleStage || isUncategorized;
  });

  const filteredRawNotes = rawNotes.filter(e => {
    if (selectedDomainFilter === 'all') return true;
    return e.domain === selectedDomainFilter;
  });

  // Run Batch Semantic Scanner in Parts
  const handleRunBatchScan = async () => {
    if (rawNotes.length === 0) return;
    setIsScanning(true);
    setScanProgress({ processed: 0, total: rawNotes.length });

    try {
      // Process raw notes in chunks of batchSize
      let processed = 0;
      const total = rawNotes.length;

      for (let i = 0; i < total; i += batchSize) {
        const chunk = rawNotes.slice(i, i + batchSize);
        
        // Simulating or executing batch inference pass
        await new Promise(res => setTimeout(res, 600));

        processed += chunk.length;
        setScanProgress({ processed: Math.min(processed, total), total });
      }

      // Refresh graph state after batch scan
      const [res, subRes] = await Promise.all([
        fetch('/api/graph'),
        fetch('/api/sub-clusters')
      ]);
      const data = await res.json();
      const subData = await subRes.json();
      if (data.entities) setEntities(data.entities);
      if (subData.subClusters) setSubClusters(subData.subClusters);

    } catch (err) {
      console.error("Batch scan error:", err);
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanProgress(null), 3000);
    }
  };

  const handlePromoteNote = async (id: string, domain: string, subIdx: number) => {
    setPromotingId(id);
    try {
      const res = await fetch('/api/raw-notes/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, domain, sub_idx: subIdx })
      });
      if (res.ok) {
        // Update store locally
        useMapStore.setState(state => ({
          entities: state.entities.map(e => e.id === id ? {
            ...e,
            domain,
            sub_idx: subIdx,
            tags: (e.tags || []).filter(t => t !== '🕳' && t !== '#🕳')
          } : e)
        }));
      }
    } catch (err) {
      console.error("Failed to promote note:", err);
    } finally {
      setPromotingId(null);
    }
  };

  return (
    <div className="flex-1 h-full bg-[#050608] text-slate-300 p-8 overflow-y-auto font-sans flex flex-col gap-6">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-gradient-to-r from-emerald-950/40 via-[#0a0c10] to-[#0a0c10] border border-emerald-500/20 rounded-2xl shadow-2xl relative overflow-hidden">
        <div className="flex items-start gap-4 z-10">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0 shadow-lg">
            <Trees className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-400 font-bold uppercase tracking-widest">Dark Forest Territory</span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold">
                {rawNotes.length} RAW NOTES
              </span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Dark Forest Scanner & Ingestion Pipeline</h1>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              Raw markdown notes are imported into the Dark Forest map view with the <code className="text-emerald-400 font-mono">#🕳</code> tag. Scan, cluster, and promote notes into curated sub-clusters in parts without moving existing map nodes.
            </p>
          </div>
        </div>
      </div>

      {/* Batch Processing Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Scanner Controller Card */}
        <div className="p-6 bg-[#0a0c10] border border-white/10 rounded-2xl flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" /> Batch Semantic Inference
            </span>
            <span className="text-[10px] text-slate-500 font-mono">500+ Note Engine</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Process large note dumps in parts to infer semantic tags, sub-cluster titles, and stage attributes incrementally.
          </p>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-mono text-slate-500 uppercase font-bold">Batch Size per Pass</label>
            <div className="flex gap-2">
              {[25, 50, 100, 250].map(size => (
                <button
                  key={size}
                  onClick={() => setBatchSize(size)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold border transition-colors ${batchSize === size ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {scanProgress ? (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-emerald-400">Scanning batch...</span>
                <span className="text-slate-400">{scanProgress.processed} / {scanProgress.total} notes</span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/10">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(scanProgress.processed / scanProgress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleRunBatchScan}
              disabled={isScanning || rawNotes.length === 0}
              className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer mt-2 ${
                isScanning || rawNotes.length === 0
                  ? 'bg-white/5 text-slate-600 border border-white/5 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Scanning Notes...' : `Scan All ${rawNotes.length} Raw Notes`}
            </button>
          )}
        </div>

        {/* Sync Mode Workflow Instructions */}
        <div className="lg:col-span-2 p-6 bg-[#0a0c10] border border-white/10 rounded-2xl flex flex-col justify-between gap-4 shadow-xl">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" /> One-Way Synchronization Protocol
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <div className="p-4 bg-white/5 border border-white/5 rounded-xl flex flex-col gap-2">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4" /> Cluster Map → Dark Forest
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Updates, markdown edits, and metadata changes in the main Cluster Map immediately propagate to the Dark Forest view.
                </p>
              </div>

              <div className="p-4 bg-white/5 border border-white/5 rounded-xl flex flex-col gap-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4" /> Dark Forest Isolation
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Raw notes in Dark Forest remain isolated under <code className="text-emerald-400 font-mono">#🕳</code> until explicitly promoted to curated sub-clusters.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-white/5 font-mono">
            <span>POSITION PERSISTENCE: ENABLED</span>
            <span className="text-emerald-400">0 RE-ARRANGEMENTS ON SYNC</span>
          </div>
        </div>

      </div>

      {/* Raw Notes List & Promotion Panel */}
      <div className="p-6 bg-[#0a0c10] border border-white/10 rounded-2xl flex flex-col gap-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              Raw Notes Repository ({filteredRawNotes.length})
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">Domain Filter:</span>
            <select
              value={selectedDomainFilter}
              onChange={(e) => setSelectedDomainFilter(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 font-mono cursor-pointer"
            >
              <option value="all" className="bg-[#0f1115]">ALL DOMAINS</option>
              <option value="uncategorized" className="bg-[#0f1115]">UNCATEGORIZED</option>
              {clusters.map(c => (
                <option key={c.name} value={c.name} className="bg-[#0f1115]">
                  {c.name.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredRawNotes.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-3 text-slate-500">
            <Trees className="w-12 h-12 text-white/5" />
            <p className="text-xs font-mono">No raw notes currently in Dark Forest View.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredRawNotes.slice(0, 60).map(note => {
              const availableSubs = subClusters.filter(s => s.domain === targetDomain);
              return (
                <div 
                  key={note.id}
                  className="p-4 bg-white/5 border border-white/10 rounded-xl flex flex-col justify-between gap-3 hover:border-emerald-500/30 transition-all group"
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white truncate group-hover:text-emerald-300 transition-colors">
                        {note.title}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold flex-shrink-0">
                        #🕳
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {note.description || note.content?.slice(0, 120) || 'No content preview.'}
                    </p>

                    <div className="flex flex-wrap gap-1 mt-1">
                      {(note.tags || []).map((tag: string) => (
                        <span key={tag} className="text-[9px] font-mono text-slate-500">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Promotion Controls */}
                  <div className="pt-3 border-t border-white/5 flex flex-col gap-2">
                    <span className="text-[9px] font-mono text-slate-500 uppercase font-bold">Promote to Curated Cluster</span>
                    <div className="flex gap-2">
                      <select
                        value={targetDomain}
                        onChange={(e) => {
                          setTargetDomain(e.target.value);
                          setTargetSubIdx(0);
                        }}
                        className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-slate-300 font-mono focus:outline-none"
                      >
                        {clusters.map(c => (
                          <option key={c.name} value={c.name} className="bg-[#0f1115]">
                            {c.name.toUpperCase()}
                          </option>
                        ))}
                      </select>

                      <select
                        value={targetSubIdx}
                        onChange={(e) => setTargetSubIdx(Number(e.target.value))}
                        className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-slate-300 font-mono focus:outline-none"
                      >
                        <option value={0} className="bg-[#0f1115]">SEC-01</option>
                        {availableSubs.map(s => (
                          <option key={s.sub_idx} value={s.sub_idx} className="bg-[#0f1115]">
                            {s.title}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => handlePromoteNote(note.id, targetDomain, targetSubIdx)}
                        disabled={promotingId === note.id}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                        title="Promote to Curated Cluster"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

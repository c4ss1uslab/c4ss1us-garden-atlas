import { useEffect, useState } from 'react';
import AtlasCanvas from './components/AtlasCanvas';
import Sidebar from './components/Sidebar';
import DesignDocs from './components/DesignDocs';
import NodeDetailsPanel from './components/NodeDetailsPanel';
import RelationshipReview from './components/RelationshipReview';
import { useMapStore } from './store';
import { MapIcon, FileText, RefreshCw, Layers, ChevronRight, Lock, Trees, Sparkles, X, Check } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'atlas' | 'design' | 'relationships'>('atlas');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showSyncPassModal, setShowSyncPassModal] = useState(false);
  const [syncPasswordInput, setSyncPasswordInput] = useState('');
  const [syncPassError, setSyncPassError] = useState(false);
  const [selectedSyncMode, setSelectedSyncMode] = useState<'curated' | 'raw'>('curated');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { setEntities, setRelationships, entities, setSubClusters, isEditUnlocked, setEditUnlocked, setViewMode } = useMapStore();

  const fetchGraph = async () => {
    try {
      const [res, subRes] = await Promise.all([
        fetch('/api/graph'),
        fetch('/api/sub-clusters')
      ]);
      const data = await res.json();
      const subData = await subRes.json();
      
      if (subData.subClusters) {
        setSubClusters(subData.subClusters);
      }
      if (data.entities && data.relationships) {
        setEntities(data.entities);
        setRelationships(data.relationships);
      }
    } catch (e) {
      console.error("Failed to fetch graph:", e);
    }
  };

  const handleOpenSyncModal = () => {
    if (!isEditUnlocked) {
      setShowSyncPassModal(true);
      setSyncPasswordInput('');
      setSyncPassError(false);
    } else {
      setShowSyncModal(true);
    }
  };

  const handleSyncPasswordSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (syncPasswordInput === 'c4ss.garden') {
      setEditUnlocked(true);
      setShowSyncPassModal(false);
      setSyncPassError(false);
      setSyncPasswordInput('');
      setShowSyncModal(true);
    } else {
      setSyncPassError(true);
    }
  };

  const handleSync = async (mode: 'curated' | 'raw') => {
    if (!isEditUnlocked) {
      setShowSyncModal(false);
      setShowSyncPassModal(true);
      setSyncPasswordInput('');
      setSyncPassError(false);
      return;
    }

    setIsSyncing(true);
    setShowSyncModal(false);
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncMode: mode })
      });
      await fetchGraph();
      if (mode === 'raw') {
        setViewMode('darkforest');
      }
    } catch (e) {
      console.error("Sync failed:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  return (
    <div className="w-full h-screen flex flex-col bg-[#050608] text-slate-300 font-sans overflow-hidden select-none">
      
      {/* Top Navigation Bar */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0a0c10]/80 backdrop-blur-md z-20 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded bg-indigo-500/20 border border-indigo-400/50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></div>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-indigo-400">c4ss1us' garden atlas</span>
            <span className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase">V.1.0</span>
          </div>
        </div>
        
        <div className="flex bg-white/5 rounded-full p-1 border border-white/10">
            <button 
                onClick={() => setActiveTab('atlas')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'atlas' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
                <MapIcon className="w-4 h-4" />
                Explorer
            </button>
            <button 
                onClick={() => setActiveTab('design')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'design' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
                <FileText className="w-4 h-4" />
                Architecture
            </button>
            <button 
                onClick={() => setActiveTab('relationships')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'relationships' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
                <Layers className="w-4 h-4" />
                <span>Semantic/Data Layer</span>
                {!isEditUnlocked && (
                  <Lock className="w-3 h-3 text-slate-400 ml-0.5" />
                )}
            </button>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleOpenSyncModal}
            disabled={isSyncing}
            className={`p-2 rounded hover:bg-white/10 transition-colors flex items-center gap-1.5 border border-white/10 cursor-pointer ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Sync & Import Notes"
          >
            <RefreshCw className={`w-4 h-4 text-slate-300 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">Sync / Import</span>
            {!isEditUnlocked && (
              <Lock className="w-3 h-3 text-slate-400 ml-0.5" />
            )}
          </button>
          <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px] text-emerald-400 font-mono">
            SYNCED: {entities.length} FILES
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {activeTab === 'atlas' && (
            <>
                <div className={`transition-all duration-300 ease-in-out h-full overflow-hidden flex flex-col flex-shrink-0 ${isSidebarOpen ? 'w-80' : 'w-0'}`}>
                    <Sidebar onClose={() => setIsSidebarOpen(false)} />
                </div>
                <div className="flex-1 h-full relative">
                    {!isSidebarOpen && (
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            title="Open Filters"
                            className="absolute left-4 top-4 z-30 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0a0c10]/95 hover:bg-[#141822] border border-white/10 text-slate-300 hover:text-slate-100 transition-all shadow-2xl font-mono text-[10px] uppercase font-bold tracking-widest cursor-pointer"
                        >
                            <ChevronRight className="w-4 h-4 text-indigo-400" />
                            Filters
                        </button>
                    )}
                    <AtlasCanvas />
                </div>
                <NodeDetailsPanel />
            </>
        )}
        {activeTab === 'design' && (
            <DesignDocs />
        )}
        {activeTab === 'relationships' && (
            <RelationshipReview />
        )}
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-8 border-t border-white/5 bg-[#0a0c10] px-4 flex items-center justify-between flex-shrink-0 z-20">
        <div className="text-[10px] font-mono text-slate-600 italic tracking-tighter ml-auto">
          CURATED TOPOLOGY MODE • MANUAL CALIBRATION ENABLED
        </div>
      </footer>

      {/* Sync Password Authorization Modal */}
      {showSyncPassModal && (
        <div className="fixed inset-0 bg-[#050608]/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#0f1115] border border-white/10 p-6 rounded-lg max-w-sm w-full mx-4 flex flex-col gap-4 shadow-2xl relative">
            <button 
              onClick={() => {
                setShowSyncPassModal(false);
                setSyncPassError(false);
                setSyncPasswordInput('');
              }}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer border-0 bg-transparent p-0"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-col gap-1 text-center">
              <span className="text-xs font-mono text-indigo-400 uppercase tracking-widest flex items-center justify-center gap-1.5 mb-1">
                <Lock className="w-3.5 h-3.5 animate-pulse" /> Architect Authorization
              </span>
              <h3 className="text-lg font-sans font-medium text-slate-100">Sync & Import Passphrase</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Enter the gardener passphrase to authorize repository sync, markdown ingestion, and note importing.</p>
            </div>
            <form onSubmit={handleSyncPasswordSubmit} className="flex flex-col gap-2">
              <input
                type="password"
                placeholder="Passphrase"
                autoFocus
                value={syncPasswordInput}
                onChange={(e) => {
                  setSyncPasswordInput(e.target.value);
                  setSyncPassError(false);
                }}
                className={`w-full bg-white/5 border rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-colors text-center font-mono ${syncPassError ? 'border-red-500/50' : 'border-white/10'}`}
              />
              {syncPassError && <span className="text-[10px] text-red-400 text-center font-mono animate-pulse">Incorrect passphrase</span>}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSyncPassModal(false);
                    setSyncPassError(false);
                    setSyncPasswordInput('');
                  }}
                  className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 rounded text-xs font-bold transition-all cursor-pointer font-sans"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition-all cursor-pointer font-sans"
                >
                  Unlock & Proceed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sync Mode Selection Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-[#050608]/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#0a0c10] border border-white/15 p-6 rounded-2xl max-w-lg w-full flex flex-col gap-5 shadow-2xl relative">
            <button
              onClick={() => setShowSyncModal(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-mono text-indigo-400 font-bold uppercase tracking-widest flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Repository Ingestion Protocol
              </span>
              <h2 className="text-lg font-bold text-white">Select Ingestion & Sync Mode</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choose how incoming markdown files from your vault should be imported and placed into the atlas. Existing node positions will be locked and strictly preserved.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {/* Option 1: Curated Notes */}
              <div
                onClick={() => setSelectedSyncMode('curated')}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col gap-2 ${
                  selectedSyncMode === 'curated'
                    ? 'bg-indigo-500/10 border-indigo-500/60 ring-1 ring-indigo-500/30'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-2">
                    <span>🌿 Option 1: Curated Notes</span>
                  </span>
                  {selectedSyncMode === 'curated' && <Check className="w-4 h-4 text-indigo-400" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Places new notes directly into sub-clusters based on their tag (e.g. <code className="text-indigo-300 font-mono">#lab</code>, <code className="text-indigo-300 font-mono">#design</code>). Syncs markdown changes on existing notes without changing their domain or rearranging node positions.
                </p>
              </div>

              {/* Option 2: Raw Notes */}
              <div
                onClick={() => setSelectedSyncMode('raw')}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col gap-2 ${
                  selectedSyncMode === 'raw'
                    ? 'bg-emerald-500/10 border-emerald-500/60 ring-1 ring-emerald-500/30'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                    <span>🕳 Option 2: Raw Notes (Dark Forest)</span>
                  </span>
                  {selectedSyncMode === 'raw' && <Check className="w-4 h-4 text-emerald-400" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Imports notes into the <span className="text-emerald-400 font-semibold">Dark Forest View</span> map mode with automatic <code className="text-emerald-300 font-mono">#🕳</code> tag. Inferred semantically in batch parts (500+ note support) for safe review before promotion.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowSyncModal(false)}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSync(selectedSyncMode)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-lg uppercase tracking-wider ${
                  selectedSyncMode === 'raw' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                Start Ingestion
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}


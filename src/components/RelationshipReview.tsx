import { useEffect, useState, useRef, useMemo } from 'react';
import { useMapStore, calculateNewNodeCoordinates } from '../store';
import { isSoftLink } from '../types';
import DarkForestScanner from './DarkForestScanner';
import { 
  Sparkles, Check, X, FileText, ArrowRight, Brain, 
  HelpCircle, RefreshCw, Layers, Play, Pause, Square, AlertCircle, ChevronDown, RotateCcw,
  Search, Trash2, PlusCircle, Database, HelpCircle as HelpIcon, Lock, Download, Upload, Trees
} from 'lucide-react';

interface PendingRelation {
  id: string;
  source: string;
  target: string;
  source_title: string;
  target_title: string;
  type: string;
  evidence: string;
  status: 'pending' | 'approved' | 'rejected';
}

const RELATIONSHIP_TYPES = [
  'created_by', 'founded_by', 'works_at', 'inspired_by', 'builds_on', 
  'critiques', 'extends', 'references', 'cites', 'uses', 'related_to', 
  'similar_to', 'opposite_of', 'depends_on', 'member_of', 'part_of', 
  'influenced', 'collaborates_with', 'applied_in', 'discusses', 
  'studies', 'mentions', 'creates'
];

export default function RelationshipReview() {
  const { 
    entities, 
    relationships, 
    clusters, 
    subClusters, 
    setRelationships, 
    setEntities, 
    updateEntityDomainInStore, 
    updateEntitySubClusterInStore,
    updateEntityCoordinatesInStore,
    deleteEntityInStore,
    selectEntity,
    isEditUnlocked,
    setEditUnlocked
  } = useMapStore();
  
  // UI Tabs: 'calibration' (AI Scanner) | 'darkforest' (Dark Forest) | 'nodes' (Nodes DB) | 'links' (Relationships DB) | 'snapshots'
  const [activeTab, setActiveTab] = useState<'calibration' | 'darkforest' | 'nodes' | 'links' | 'snapshots'>('calibration');
  
  // Backups Session Lock State
  const [backupPasswordInput, setBackupPasswordInput] = useState('');
  const [backupPassError, setBackupPassError] = useState(false);
  
  // Base State
  const [pendingList, setPendingList] = useState<PendingRelation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<string>('');
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [isActioning, setIsActioning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Snapshots State
  interface Snapshot {
    filename: string;
    timestamp: string;
    name: string;
    entityCount: number;
    relationshipCount: number;
    pendingCount: number;
    sizeBytes: number;
  }
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoringSnapshot, setRestoringSnapshot] = useState<string | null>(null);
  const [deletingSnapshot, setDeletingSnapshot] = useState<string | null>(null);

  // Custom Confirmation Modal States
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<string | null>(null);
  const [confirmRestoreName, setConfirmRestoreName] = useState<string>('');
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>('');

  // Node Deletion & Sync Blocklist State
  const [nodeToDelete, setNodeToDelete] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingNode, setIsDeletingNode] = useState(false);
  const [deletedEntities, setDeletedEntities] = useState<Array<{ id: string; filename: string; title: string; relative_path: string; deleted_at: string }>>([]);
  const [showDeletedList, setShowDeletedList] = useState(false);
  const [restoringEntityId, setRestoringEntityId] = useState<string | null>(null);

  // Search & Filter State
  const [nodeSearch, setNodeSearch] = useState('');
  const [relationshipSearch, setRelationshipSearch] = useState('');

  // Manual Creation State
  const [manualSource, setManualSource] = useState('');
  const [manualTarget, setManualTarget] = useState('');
  const [manualType, setManualType] = useState('references');
  const [manualEvidence, setManualEvidence] = useState('');
  const [manualVisibilityMode, setManualVisibilityMode] = useState<'visible' | 'soft_link' | 'not_visible'>('visible');
  const [isCreatingManual, setIsCreatingManual] = useState(false);
  const [manualLinkCategory, setManualLinkCategory] = useState<'node' | 'subcluster'>('node');

  // Advanced Step-by-Step Scanner state
  const [scanStatus, setScanStatus] = useState<'idle' | 'running' | 'paused' | 'cooldown'>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [currentEntityName, setCurrentEntityName] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash');
  const [cooldownTimeLeft, setCooldownTimeLeft] = useState(0);
  const [rateLimitRetries, setRateLimitRetries] = useState(0);

  // Click-to-confirm safe reset tracker state
  const [confirmReset, setConfirmReset] = useState(false);

  // Track scanned nodes in localStorage for full persistence
  const [scannedNodeIds, setScannedNodeIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('c4ss1us_scanned_nodes');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Keep ref to control active loop
  const scanLoopRef = useRef<boolean>(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    localStorage.setItem('c4ss1us_scanned_nodes', JSON.stringify(scannedNodeIds));
  }, [scannedNodeIds]);

  const fetchPending = async () => {
    try {
      const res = await fetch('/api/relationships/pending');
      const data = await res.json();
      if (data.pending) {
        setPendingList(data.pending);
      }
    } catch (e) {
      console.error("Failed to fetch pending relationships:", e);
    }
  };

  const fetchGraph = async () => {
    try {
      const res = await fetch('/api/graph');
      const data = await res.json();
      if (data.entities && data.relationships) {
        setEntities(data.entities);
        setRelationships(data.relationships);
      }
    } catch (e) {
      console.error("Failed to fetch graph:", e);
    }
  };

  const fetchSnapshots = async () => {
    try {
      const res = await fetch('/api/snapshots');
      const data = await res.json();
      if (data.snapshots) {
        setSnapshots(data.snapshots);
      }
    } catch (e) {
      console.error("Failed to fetch snapshots:", e);
    }
  };

  const fetchDeletedEntities = async () => {
    try {
      const res = await fetch('/api/entities/deleted');
      const data = await res.json();
      if (data.deleted) {
        setDeletedEntities(data.deleted);
      }
    } catch (e) {
      console.error("Failed to fetch deleted entities:", e);
    }
  };

  const handleConfirmDeleteNode = async () => {
    if (!nodeToDelete) return;
    setIsDeletingNode(true);
    try {
      const res = await fetch('/api/entities/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeToDelete.id })
      });
      const data = await res.json();
      setIsDeletingNode(false);
      if (data.status === 'success') {
        deleteEntityInStore(nodeToDelete.id);
        setStatusMessage(`Successfully deleted "${nodeToDelete.title}". It is now blocked from GitHub/file syncs.`);
        setTimeout(() => setStatusMessage(null), 5000);
        setNodeToDelete(null);
        fetchDeletedEntities();
      } else {
        setStatusMessage(`Failed to delete node: ${data.error || 'Unknown error'}`);
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      setIsDeletingNode(false);
      setStatusMessage(`Error deleting node: ${(err as Error).message}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleRestoreDeletedNode = async (id: string, title: string) => {
    setRestoringEntityId(id);
    try {
      const res = await fetch('/api/entities/restore-deleted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      setRestoringEntityId(null);
      if (data.status === 'success') {
        setStatusMessage(`Unblocked "${title}". When you sync files with GitHub again, this note will be re-ingested.`);
        setTimeout(() => setStatusMessage(null), 5000);
        fetchDeletedEntities();
      } else {
        setStatusMessage(`Failed to unblock node: ${data.error || 'Unknown error'}`);
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      setRestoringEntityId(null);
      setStatusMessage(`Error unblocking node: ${(err as Error).message}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  useEffect(() => {
    if (activeTab === 'snapshots') {
      fetchSnapshots();
    } else if (activeTab === 'nodes') {
      fetchDeletedEntities();
    }
  }, [activeTab]);

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingSnapshot || !newSnapshotName.trim()) return;
    setIsCreatingSnapshot(true);
    try {
      const res = await fetch('/api/snapshots/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSnapshotName })
      });
      if (res.ok) {
        setNewSnapshotName('');
        await fetchSnapshots();
        showFeedback("Snapshot saved successfully!");
      } else {
        showFeedback("Failed to save snapshot.");
      }
    } catch (e) {
      console.error("Failed to save snapshot:", e);
      showFeedback("Failed to save snapshot.");
    } finally {
      setIsCreatingSnapshot(false);
    }
  };
  const handleImportSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      const text = await file.text();
      JSON.parse(text);

      const res = await fetch("/api/snapshots/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: text })
      });

      if (!res.ok) throw new Error("Failed to import snapshot");
      
      showFeedback("Snapshot imported successfully!");
      await fetchSnapshots();
    } catch (e) {
      console.error("Failed to import snapshot:", e);
      showFeedback("Failed to import snapshot.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };


  const triggerRestoreSnapshot = (filename: string, name: string) => {
    setConfirmRestoreFile(filename);
    setConfirmRestoreName(name);
  };

  const handleConfirmRestore = async () => {
    if (!confirmRestoreFile || restoringSnapshot) return;
    const filename = confirmRestoreFile;
    setRestoringSnapshot(filename);
    setConfirmRestoreFile(null);
    try {
      const res = await fetch('/api/snapshots/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      if (res.ok) {
        showFeedback("Snapshot successfully restored! Reinitializing application...");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        showFeedback("Failed to restore snapshot.");
      }
    } catch (e) {
      console.error("Failed to restore snapshot:", e);
      showFeedback("Failed to restore snapshot.");
    } finally {
      setRestoringSnapshot(null);
    }
  };

  const triggerDeleteSnapshot = (filename: string, name: string) => {
    setConfirmDeleteFile(filename);
    setConfirmDeleteName(name);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteFile || deletingSnapshot) return;
    const filename = confirmDeleteFile;
    setDeletingSnapshot(filename);
    setConfirmDeleteFile(null);
    try {
      const res = await fetch('/api/snapshots/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      if (res.ok) {
        await fetchSnapshots();
        showFeedback("Snapshot file deleted.");
      } else {
        showFeedback("Failed to delete snapshot.");
      }
    } catch (e) {
      console.error("Failed to delete snapshot:", e);
      showFeedback("Failed to delete snapshot.");
    } finally {
      setDeletingSnapshot(null);
    }
  };

  // Cooldown countdown timer
  useEffect(() => {
    if (scanStatus === 'cooldown' && cooldownTimeLeft > 0) {
      cooldownTimerRef.current = setTimeout(() => {
        setCooldownTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (scanStatus === 'cooldown' && cooldownTimeLeft === 0) {
      setScanStatus('running');
      resumeScanLoop();
    }
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, [scanStatus, cooldownTimeLeft]);

  // Approval Flow
  const handleApprove = async (id: string, customType?: string) => {
    setIsActioning(id);
    try {
      const res = await fetch('/api/relationships/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, type: customType })
      });
      if (res.ok) {
        await fetchPending();
        await fetchGraph();
        showFeedback("Relationship approved and successfully confirmed on the live map.");
      }
    } catch (e) {
      console.error("Approval failed:", e);
    } finally {
      setIsActioning(null);
    }
  };

  // Reject Flow (Removes from both active relationships and pending)
  const handleReject = async (id: string) => {
    setIsActioning(id);
    try {
      const res = await fetch('/api/relationships/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        await fetchPending();
        await fetchGraph();
        showFeedback("Relationship rejected and removed from live map.");
      }
    } catch (e) {
      console.error("Rejection failed:", e);
    } finally {
      setIsActioning(null);
    }
  };

  // Direct edit of relationship type
  const handleConfirmType = async (id: string, newType: string) => {
    try {
      const res = await fetch('/api/relationships/update-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, type: newType })
      });
      if (res.ok) {
        setPendingList(prev => prev.map(item => item.id === id ? { ...item, type: newType } : item));
        await fetchGraph(); // update active graph type instantly
        setEditingId(null);
        showFeedback("Relationship type updated successfully!");
      } else {
        showFeedback("Failed to update relationship type.");
      }
    } catch (e) {
      console.error("Failed to update relationship type:", e);
      showFeedback("Failed to update relationship type.");
    }
  };

  // Direct manual deletion of relationship
  const handleDeleteRelationship = async (id: string) => {
    try {
      const res = await fetch('/api/relationships/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        await fetchPending();
        await fetchGraph();
        showFeedback("Relationship deleted from database.");
      } else {
        showFeedback("Failed to delete relationship.");
      }
    } catch (e) {
      console.error("Failed to delete relationship:", e);
    }
  };

  // Toggle relationship visibility on map
  const handleToggleVisibility = async (id: string, visible: boolean) => {
    try {
      const res = await fetch('/api/relationships/update-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, visible })
      });
      if (res.ok) {
        setRelationships((relationships || []).filter(Boolean).map(r => r && r.id === id ? { ...r, visible } : r));
        showFeedback(`Relationship visibility set to ${visible ? 'visible' : 'hidden'}.`);
      } else {
        showFeedback("Failed to update relationship visibility.");
      }
    } catch (e) {
      console.error("Failed to update visibility:", e);
      showFeedback("Failed to update relationship visibility.");
    }
  };

  // Direct manual creation of relationship
  const handleCreateManualRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSource || !manualTarget) {
      showFeedback("Please select both source and target notes.");
      return;
    }
    if (manualSource === manualTarget) {
      showFeedback("Cannot link a note to itself.");
      return;
    }

    setIsCreatingManual(true);
    try {
      const isSoft = manualVisibilityMode === 'soft_link';
      const isVisible = manualVisibilityMode !== 'not_visible';
      const evidenceToSave = isSoft 
        ? (manualEvidence ? `${manualEvidence.trim()} [Soft: true]` : 'Manually created soft link [Soft: true]')
        : (manualEvidence || 'Manually created connection');

      const res = await fetch('/api/relationships/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: manualSource,
          target: manualTarget,
          type: manualType,
          evidence: evidenceToSave,
          visible: isVisible
        })
      });
      if (res.ok) {
        await fetchPending();
        await fetchGraph();
        setManualTarget('');
        setManualEvidence('');
        setManualVisibilityMode('visible');
        showFeedback("Manual relationship created and synced to live map!");
      } else {
        showFeedback("Error creating manual relationship.");
      }
    } catch (e) {
      console.error("Error creating manual relationship:", e);
    } finally {
      setIsCreatingManual(false);
    }
  };

  // Inline Node Domain/Cluster Change
  const handleNodeClusterChange = async (entityId: string, newDomain: string) => {
    const entity = entities.find(e => e.id === entityId);
    let newCoords = { x: 0, y: 0 };
    if (entity) {
      newCoords = calculateNewNodeCoordinates(entities, subClusters, newDomain, entity.sub_idx, entityId);
      updateEntityCoordinatesInStore(entityId, newCoords.x, newCoords.y, newDomain);
    } else {
      updateEntityDomainInStore(entityId, newDomain);
    }

    try {
      await fetch('/api/entities/update-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entityId, domain: newDomain, x: newCoords.x, y: newCoords.y })
      });
      showFeedback(`Node cluster updated to ${newDomain}.`);
    } catch (e) {
      console.error("Error updating cluster:", e);
      showFeedback("Failed to update cluster on backend.");
    }
  };

  // Inline Node Sub-Cluster Change
  const handleNodeSubClusterChange = async (entityId: string, newSubIdx: number | null) => {
    const entity = entities.find(e => e.id === entityId);
    let newCoords = { x: 0, y: 0 };
    if (entity) {
      newCoords = calculateNewNodeCoordinates(entities, subClusters, entity.domain, newSubIdx, entityId);
      updateEntitySubClusterInStore(entityId, newSubIdx);
      updateEntityCoordinatesInStore(entityId, newCoords.x, newCoords.y);
    } else {
      updateEntitySubClusterInStore(entityId, newSubIdx);
    }

    try {
      await fetch('/api/entities/update-subcluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entityId, sub_idx: newSubIdx, x: newCoords.x, y: newCoords.y })
      });
      showFeedback(`Node sub-cluster updated.`);
    } catch (e) {
      console.error("Error updating sub-cluster:", e);
      showFeedback("Failed to update sub-cluster on backend.");
    }
  };

  // Step-by-Step AI Scanner Loop
  const triggerStepExtraction = async (entityId: string, model: string) => {
    const res = await fetch('/api/relationships/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, model })
    });
    if (!res.ok) {
      throw { status: res.status, message: `Server error: ${res.statusText}` };
    }
    return await res.json();
  };

  const startScan = () => {
    if (entities.length === 0) return;
    scanLoopRef.current = true;
    setTotalToProcess(entities.length);
    setScanStatus('running');
    runScanIteration(currentIndex < entities.length ? currentIndex : 0);
  };

  const pauseScan = () => {
    scanLoopRef.current = false;
    setScanStatus('paused');
    showFeedback("Scan paused. You can resume at any time.");
  };

  const stopScan = () => {
    scanLoopRef.current = false;
    setScanStatus('idle');
    setCurrentEntityName(null);
    showFeedback("Scan stopped.");
  };

  // Smart non-blocking click-to-confirm Reset Progress tracker
  const resetScannedTracker = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000); // Revert after 4 seconds
      showFeedback("Click Reset button again to confirm clearing progress.");
    } else {
      setScannedNodeIds([]);
      setCurrentIndex(0);
      setConfirmReset(false);
      showFeedback("Scanned progress has been reset successfully. Scan started from index 0.");
    }
  };

  const resumeScanLoop = () => {
    scanLoopRef.current = true;
    runScanIteration(currentIndex);
  };

  const runScanIteration = async (startIndex: number) => {
    let index = startIndex;
    
    while (scanLoopRef.current && index < entities.length) {
      const entity = entities[index];
      setCurrentIndex(index);

      // Skip already scanned nodes
      if (scannedNodeIds.includes(entity.id)) {
        index++;
        continue;
      }

      setCurrentEntityName(entity.title);

      try {
        await triggerStepExtraction(entity.id, selectedModel);
        
        // Mark node as successfully scanned
        setScannedNodeIds(prev => [...prev, entity.id]);
        
        // Refresh pending AND active graph in real-time
        await fetchPending();
        await fetchGraph();
        
        // Small delay to prevent sudden rate limit
        await new Promise(r => setTimeout(r, 600));
        
        index++;
      } catch (err: any) {
        console.error("Scan step failed:", err);
        
        if (err?.status === 429) {
          // Rate Limit Hit
          scanLoopRef.current = false;
          setScanStatus('cooldown');
          setCooldownTimeLeft(15); // Wait 15 seconds
          setRateLimitRetries(prev => prev + 1);
          
          // Auto fallback model after 1 rate limit hit
          if (rateLimitRetries >= 0 && selectedModel === 'gemini-3.5-flash') {
            setSelectedModel('gemini-3.1-flash-lite');
            showFeedback("Frequent rate limits hit. Auto-switching to fallback Gemini 3.1 Flash Lite.");
          }
          break;
        } else {
          console.warn(`Continuing despite error on node: ${entity.title}`);
          setScannedNodeIds(prev => [...prev, entity.id]);
          index++;
        }
      }
    }

    if (index >= entities.length) {
      setScanStatus('idle');
      setCurrentEntityName(null);
      showFeedback("Finished scanning the entire digital garden!");
    }
  };

  const showFeedback = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const filteredInferences = pendingList.filter(item => item.status === filter);

  // Filtered nodes for DB Nodes Explorer
  const filteredNodes = useMemo(() => {
    if (!nodeSearch) return entities;
    const query = nodeSearch.toLowerCase();
    return entities.filter(e => 
      e.title.toLowerCase().includes(query) || 
      e.domain.toLowerCase().includes(query) ||
      e.tags?.some(t => t.toLowerCase().includes(query)) ||
      e.id.toLowerCase().includes(query)
    );
  }, [entities, nodeSearch]);

  // Helper to map entity ID or subcluster ID to title
  const getEntityTitle = (id: string) => {
    if (!id) return '';
    if (typeof id === 'string' && id.startsWith('subcluster:')) {
      const parts = id.split(':');
      const domain = parts[1];
      const subIdx = Number(parts[2]);
      const sc = subClusters.find(s => s.domain === domain && s.sub_idx === subIdx);
      const title = sc ? sc.title : `SEC-0${subIdx + 1}`;
      return `${domain} › ${title}`;
    }
    const e = (entities || []).find(item => item && item.id === id);
    return e ? e.title : id;
  };

  // Filtered active relationships for DB Relationships Manager
  const filteredActiveRelationships = useMemo(() => {
    const activeRels = (relationships || []).filter(Boolean);
    if (!relationshipSearch) return activeRels;
    const query = relationshipSearch.toLowerCase();
    return activeRels.filter(r => {
      if (!r) return false;
      const sourceTitle = getEntityTitle(r.source);
      const targetTitle = getEntityTitle(r.target);
      return (
        (sourceTitle && sourceTitle.toLowerCase().includes(query)) ||
        (targetTitle && targetTitle.toLowerCase().includes(query)) ||
        (r.type && r.type.toLowerCase().includes(query))
      );
    });
  }, [relationships, entities, subClusters, relationshipSearch]);

  const nodeRelationships = useMemo(() => {
    return filteredActiveRelationships.filter(r => !r.source.startsWith('subcluster:') && !r.target.startsWith('subcluster:'));
  }, [filteredActiveRelationships]);

  const subClusterRelationships = useMemo(() => {
    return filteredActiveRelationships.filter(r => r.source.startsWith('subcluster:') || r.target.startsWith('subcluster:'));
  }, [filteredActiveRelationships]);

  const allSubClusterOptions = useMemo(() => {
    const list: Array<{ id: string; title: string }> = [];
    const domains = Array.from(new Set(clusters.map(c => c.name)));
    domains.forEach(domain => {
      const domainSubs = subClusters.filter(s => s.domain === domain);
      const indices = new Set<number>();
      domainSubs.forEach(s => indices.add(s.sub_idx));
      for (let i = 0; i < 8; i++) indices.add(i);
      Array.from(indices).sort((a, b) => a - b).forEach(subIdx => {
        const sc = domainSubs.find(s => s.sub_idx === subIdx);
        const title = sc ? sc.title : `SEC-0${subIdx + 1}`;
        list.push({
          id: `subcluster:${domain}:${subIdx}`,
          title: `${domain} › ${title}`
        });
      });
    });
    return list;
  }, [clusters, subClusters]);

  // Helper for sub-cluster options of a node
  const getSubClusterOptions = (domain: string, entityId: string) => {
    const clusterEntities = entities
      .filter(e => e.domain === domain)
      .sort((a, b) => a.id.localeCompare(b.id));
      
    const maxAssignedSubIdx = clusterEntities.reduce((max: number, de: any) => {
      return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
    }, -1);
    
    const domainSubs = subClusters.filter(s => s.domain === domain);
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
      const sc = subClusters.find(s => s.domain === domain && s.sub_idx === i);
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
        const children = subClusters.filter(s => s.domain === domain && s.parent_sub_idx === i);
        children.forEach(ch => {
          if (!addedIndices.has(ch.sub_idx)) {
            list.push({ sub_idx: ch.sub_idx, title: `  ↳ ${ch.title}` });
            addedIndices.add(ch.sub_idx);
          }
        });
      }
    }

    subClusters.forEach(sc => {
      if (sc.domain === domain && sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined) {
        if (!addedIndices.has(sc.sub_idx)) {
          list.push({ sub_idx: sc.sub_idx, title: `  ↳ ${sc.title}` });
          addedIndices.add(sc.sub_idx);
        }
      }
    });

    return list;
  };

  // Helper to resolve actual sub-cluster of a node dynamically (matching map behavior)
  const getEntitySubClusterInfo = (node: any) => {
    if (!node) return { subIdx: 0, title: 'SEC-01' };
    const clusterEntities = entities
      .filter(e => e.domain === node.domain)
      .sort((a, b) => a.id.localeCompare(b.id));
      
    const maxAssignedSubIdx = clusterEntities.reduce((max: number, de: any) => {
      return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
    }, -1);
    
    const domainSubs = subClusters.filter(s => s.domain === node.domain);
    const maxSubClusterIdx = domainSubs.reduce((max: number, ds: any) => {
      return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
    }, -1);
    
    let numSubClusters = 8;
    const maxIdx = Math.max(maxAssignedSubIdx, maxSubClusterIdx);
    if (maxIdx >= numSubClusters) {
      numSubClusters = maxIdx + 1;
    }
    if (numSubClusters === 0) return { subIdx: 0, title: 'SEC-01' };
    
    const idx = clusterEntities.findIndex(e => e.id === node.id);
    if (idx === -1) return { subIdx: 0, title: 'SEC-01' };
    
    const subIdx = (node.sub_idx !== null && node.sub_idx !== undefined && node.sub_idx < numSubClusters)
      ? node.sub_idx
      : idx % numSubClusters;
      
    const sc = subClusters.find(s => s.domain === node.domain && s.sub_idx === subIdx);
    if (!sc) return { subIdx, title: `SEC-0${subIdx + 1}` };

    if (sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined) {
      const parentSc = subClusters.find(s => s.domain === node.domain && s.sub_idx === sc.parent_sub_idx);
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

  const getTypeColor = (type: string) => {
    const crimson = ['critiques', 'opposite_of'];
    const emerald = ['builds_on', 'extends', 'applied_in'];
    const purple = ['inspired_by', 'influenced', 'collaborates_with'];
    const blue = ['references', 'cites', 'studies', 'discusses', 'mentions'];
    const gold = ['created_by', 'founded_by', 'works_at', 'uses', 'depends_on'];

    if (crimson.includes(type)) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    if (emerald.includes(type)) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (purple.includes(type)) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    if (blue.includes(type)) return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    if (gold.includes(type)) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  };

  const progressPercent = entities.length > 0 ? Math.round((scannedNodeIds.length / entities.length) * 100) : 0;

  if (!isEditUnlocked) {
    return (
      <div className="flex-1 h-full bg-[#050608] flex items-center justify-center p-8">
        <div className="bg-[#0a0c10]/80 border border-white/10 p-8 rounded-xl max-w-sm w-full mx-auto shadow-2xl flex flex-col gap-6 backdrop-blur-md relative">
          <div className="flex flex-col gap-2 text-center">
            <span className="text-xs font-mono text-indigo-400 uppercase tracking-widest flex items-center justify-center gap-1.5 mb-1">
              <Lock className="w-4 h-4 animate-pulse text-indigo-400" /> Semantic & Data Layer Locked
            </span>
            <h3 className="text-lg font-sans font-bold text-slate-100">Gardener Authentication</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enter the gardener passphrase to access LLM relationship discovery, taxonomy configuration, active links, and snapshot archives.
            </p>
          </div>
          
          <div className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Passphrase"
              autoFocus
              value={backupPasswordInput}
              onChange={(e) => {
                setBackupPasswordInput(e.target.value);
                setBackupPassError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (backupPasswordInput === 'c4ss.garden') {
                    setEditUnlocked(true);
                    setBackupPassError(false);
                    setBackupPasswordInput('');
                    showFeedback("Semantic/Data Layer unlocked successfully.");
                  } else {
                    setBackupPassError(true);
                  }
                }
              }}
              className={`w-full bg-[#050608] border rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors text-center font-mono ${backupPassError ? 'border-red-500/50 focus:border-red-500' : 'border-white/10'}`}
            />
            {backupPassError && (
              <span className="text-[10px] text-red-400 text-center font-mono animate-pulse">
                Incorrect passphrase
              </span>
            )}
          </div>

          <button
            onClick={() => {
              if (backupPasswordInput === 'c4ss.garden') {
                setEditUnlocked(true);
                setBackupPassError(false);
                setBackupPasswordInput('');
                showFeedback("Semantic/Data Layer unlocked successfully.");
              } else {
                setBackupPassError(true);
              }
            }}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans shadow-lg shadow-indigo-600/20"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full bg-[#050608] flex flex-col overflow-y-auto relative">
      {/* Toast Status Feedback */}
      {statusMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-[#0f1115] border border-indigo-500/30 text-indigo-300 text-xs px-4 py-2.5 rounded-md shadow-2xl z-50 animate-fade-in flex items-center gap-2">
          <Brain className="w-4 h-4 animate-pulse text-indigo-400" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Main Header / Title */}
      <div className="p-8 border-b border-white/5 flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-[#0a0c10]/40 flex-shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-indigo-400" />
            <h1 className="text-sm font-bold tracking-[0.2em] uppercase text-slate-200">Semantic & Data Layer Explorer</h1>
          </div>
          <p className="text-xs text-slate-500 max-w-2xl">
            Inspect, calibrate, and directly update c4ss1us' garden database storage in real-time. Changes made here sync instantly with active map layouts and nodes.
          </p>
        </div>

        {/* View Mode Tab Switchers */}
        <div className="flex bg-white/5 p-1 rounded-lg border border-white/10 self-start lg:self-auto flex-shrink-0">
          <button
            onClick={() => setActiveTab('calibration')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'calibration' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Layers className="w-3.5 h-3.5" />
            AI Scanner
          </button>
          <button
            onClick={() => setActiveTab('darkforest')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'darkforest' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Trees className="w-3.5 h-3.5 text-emerald-400" />
            Dark Forest
          </button>
          <button
            onClick={() => setActiveTab('nodes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'nodes' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Database className="w-3.5 h-3.5" />
            Database Nodes ({entities.length})
          </button>
          <button
            onClick={() => setActiveTab('links')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'links' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Active Links ({relationships.length})
          </button>
          <button
            onClick={() => setActiveTab('snapshots')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'snapshots' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Snapshots & Backups</span>
            {!isEditUnlocked && (
              <Lock className="w-3 h-3 text-slate-500 ml-1.5 flex-shrink-0" />
            )}
          </button>
        </div>
      </div>

      {/* ======================= SUB-TAB: DARK FOREST ======================= */}
      {activeTab === 'darkforest' && (
        <DarkForestScanner />
      )}

      {/* ======================= SUB-TAB 1: AI CALIBRATOR ======================= */}
      {activeTab === 'calibration' && (
        <div className="flex flex-col flex-1">
          {/* Scanner Controls and Info Dashboard */}
          <div className="px-8 py-5 border-b border-white/5 bg-[#0a0c10]/20 flex flex-col md:flex-row md:items-center justify-between gap-6 flex-shrink-0">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 font-mono tracking-wider uppercase">LLM Relationship Discovery</span>
              <p className="text-xs text-slate-400 max-w-lg">
                Activate the deep garden scanner to parse notes using Gemini and propose semantic relationships. 
                <span className="text-indigo-400 font-semibold ml-1">Pre-approved flow enabled:</span> extracted links map instantly; discard or modify them below.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-white/[0.02] border border-white/5 p-3 rounded-lg max-w-md w-full md:w-auto">
              {/* Model Select */}
              <div className="flex flex-col gap-1 pr-3 border-r border-white/5">
                <label className="text-[9px] font-bold text-slate-500 font-mono tracking-wider uppercase">Active Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={scanStatus === 'running'}
                  className="bg-transparent text-xs text-indigo-400 font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="gemini-3.5-flash" className="bg-[#050608]">Gemini 3.5 Flash (Default)</option>
                  <option value="gemini-3.1-flash-lite" className="bg-[#050608]">Gemini 3.1 Flash Lite (Recommended/Lite)</option>
                  <option value="gemini-1.5-flash" className="bg-[#050608]">Gemini 1.5 Flash (Legacy)</option>
                </select>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {scanStatus === 'idle' && (
                  <button
                    onClick={startScan}
                    className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Scan Garden
                  </button>
                )}

                {scanStatus === 'running' && (
                  <button
                    onClick={pauseScan}
                    className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </button>
                )}

                {scanStatus === 'paused' && (
                  <div className="flex gap-1">
                    <button
                      onClick={resumeScanLoop}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Resume
                    </button>
                    <button
                      onClick={stopScan}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop
                    </button>
                  </div>
                )}

                {scanStatus === 'cooldown' && (
                  <div className="flex items-center gap-2 text-rose-400 font-mono text-xs font-bold">
                    <AlertCircle className="w-4 h-4 animate-bounce" />
                    Wait {cooldownTimeLeft}s...
                  </div>
                )}

                <button
                  onClick={resetScannedTracker}
                  title="Reset progress tracker to scan from start"
                  className={`p-2 rounded border transition-all cursor-pointer ${confirmReset ? 'bg-rose-500/20 border-rose-500/50 text-rose-300' : 'bg-white/5 hover:bg-white/10 border-white/5 text-slate-500 hover:text-slate-300'}`}
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${confirmReset ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Progress Tracker Bar */}
          {(scanStatus !== 'idle' || scannedNodeIds.length > 0) && (
            <div className="px-8 py-3.5 bg-[#0a0c10]/10 border-b border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <div className="flex items-center gap-2 text-slate-400">
                  <span className="font-bold text-indigo-400">Scan Progress:</span>
                  <span>{scannedNodeIds.length} / {entities.length} Notes Analyzed</span>
                  {currentEntityName && scanStatus === 'running' && (
                    <span className="text-slate-600 italic">| Extracting: {currentEntityName}</span>
                  )}
                </div>
                <div className="font-bold text-indigo-400">{progressPercent}% Complete</div>
              </div>
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Inferences Lists Sub-Tabs */}
          <div className="px-8 pt-5 border-b border-white/5 bg-[#0a0c10]/20 flex justify-between items-center flex-shrink-0">
            <div className="flex gap-4">
              {(['pending', 'approved', 'rejected'] as const).map(tab => {
                const count = pendingList.filter(item => item.status === tab).length;
                return (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`pb-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all relative ${
                      filter === tab 
                        ? 'border-indigo-500 text-indigo-400 font-extrabold' 
                        : 'border-transparent text-slate-600 hover:text-slate-400'
                    }`}
                  >
                    {tab === 'pending' ? 'Pre-Approved (Pending Review)' : tab}
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-white/5 border border-white/10 text-slate-500">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="text-[10px] text-slate-600 font-mono flex items-center gap-1.5 pb-3">
              <HelpCircle className="w-3.5 h-3.5 text-slate-700" />
              INFERENCES MAP AUTOMATICALLY ON GRAPH IN REAL-TIME
            </div>
          </div>

          {/* Inferences Cards List */}
          <div className="p-8 pb-20">
            {filteredInferences.length === 0 ? (
              <div className="min-h-[250px] flex flex-col items-center justify-center text-center p-12 border border-dashed border-white/5 rounded-lg bg-white/[0.01]">
                <Brain className="w-12 h-12 text-white/5 mb-4" />
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  No {filter} inferences
                </h2>
                <p className="text-xs text-slate-600 max-w-sm">
                  {filter === 'pending' 
                    ? 'Excellent! Run a digital garden scan to generate relationship inferences from note contents.' 
                    : `No relationships found under status "${filter}".`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 max-w-5xl">
                {filteredInferences.map(item => {
                  const isCurrentlyMapped = (relationships || []).some(r => r && r.id === item.id);
                  return (
                    <div 
                      key={item.id} 
                      className={`p-5 rounded border bg-[#0a0c10]/40 flex flex-col gap-4 relative group transition-all duration-300 ${
                        isCurrentlyMapped 
                          ? 'border-indigo-500/20 hover:border-indigo-500/35 bg-[#0a0c10]/60' 
                          : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      {/* Mapping Status Badge */}
                      <div className="absolute top-4 right-4 flex items-center gap-1.5">
                        {isCurrentlyMapped ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-mono font-bold bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 uppercase">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />
                            Active on Map
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[8px] font-mono font-bold bg-slate-500/10 border border-slate-500/20 text-slate-500 uppercase">
                            Discarded / Inactive
                          </span>
                        )}
                      </div>

                      {/* Connection Header */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">Inferred Pairwise Link</span>
                        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                          
                          <div className="flex flex-col gap-1">
                            <span className="text-[8px] text-indigo-400/70 uppercase tracking-widest font-mono">From Note</span>
                            <div className="flex items-center gap-1.5 text-slate-300 font-semibold bg-white/5 px-2.5 py-1.5 rounded border border-white/5">
                              <FileText className="w-3.5 h-3.5 text-indigo-400" />
                              {item.source_title}
                            </div>
                          </div>

                          <div className="flex flex-col items-center justify-center pt-2 px-1 relative">
                            <ArrowRight className="w-4 h-4 text-indigo-400/40" />
                            {editingId === item.id ? (
                              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-slate-950 border border-indigo-500/50 rounded-xl p-3 shadow-2xl flex flex-col gap-2.5 min-w-[200px]">
                                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block border-b border-white/5 pb-1 font-mono">
                                  Select Relation Type
                                </span>
                                <select
                                  value={editingType}
                                  onChange={(e) => setEditingType(e.target.value)}
                                  className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-[10px] font-mono uppercase text-slate-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
                                >
                                  {RELATIONSHIP_TYPES.map(t => (
                                    <option key={t} value={t}>
                                      {t.replace('_', ' ')}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex justify-end gap-1.5 border-t border-white/5 pt-2">
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 text-[9px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleConfirmType(item.id, editingType)}
                                    className="px-2 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[9px] font-mono text-indigo-300 hover:text-indigo-200 transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                    Confirm
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  if (item.status === 'pending') {
                                    setEditingId(item.id);
                                    setEditingType(item.type);
                                  }
                                }}
                                disabled={item.status !== 'pending'}
                                className={`mt-1.5 px-2 py-0.5 rounded text-[9px] font-mono border uppercase tracking-wider flex items-center gap-1 transition-colors ${
                                  item.status === 'pending'
                                    ? 'hover:bg-indigo-500/10 hover:border-indigo-500/30 cursor-pointer'
                                    : 'opacity-85'
                                } ${getTypeColor(item.type)}`}
                                title={item.status === 'pending' ? "Click to change relationship type" : undefined}
                              >
                                {item.type.replace('_', ' ')}
                                {item.status === 'pending' && <ChevronDown className="w-3 h-3 opacity-60" />}
                              </button>
                            )}
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[8px] text-purple-400/70 uppercase tracking-widest font-mono font-bold">To Note</span>
                            <div className="flex items-center gap-1.5 text-slate-300 font-semibold bg-white/5 px-2.5 py-1.5 rounded border border-white/5">
                              <FileText className="w-3.5 h-3.5 text-indigo-400" />
                              {item.target_title}
                            </div>
                          </div>

                        </div>
                      </div>

                      {/* Evidence Snippet */}
                      {item.evidence && (
                        <div className="flex flex-col gap-1.5 mt-1">
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                            Evidence Context (Extracted quote from file content):
                          </span>
                          <div className="text-xs text-slate-400 border-l border-indigo-500/30 pl-4 py-1.5 bg-indigo-500/[0.01] italic leading-relaxed font-sans">
                            "{item.evidence}"
                          </div>
                        </div>
                      )}

                      {/* Review Actions */}
                      <div className="flex justify-end gap-2 border-t border-white/5 pt-4 mt-1 flex-shrink-0">
                        {item.status !== 'approved' && (
                          <button
                            onClick={() => handleApprove(item.id, item.type)}
                            disabled={isActioning !== null}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Lock Approval (Reviewed)
                          </button>
                        )}
                        {item.status !== 'rejected' && (
                          <button
                            onClick={() => handleReject(item.id)}
                            disabled={isActioning !== null}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 text-rose-400 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            Reject & Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}


      {/* ======================= SUB-TAB 2: DATABASE NODES EXPLORER ======================= */}
      {activeTab === 'nodes' && (
        <div className="p-8 pb-24 flex flex-col flex-1 max-w-6xl">
          {/* Sub-header & Search bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 font-mono tracking-wider uppercase">Node Storage Management (`entities` table)</span>
              <p className="text-xs text-slate-400">
                View nodes stored in the database. Directly move nodes between domains and sub-clusters. Changes take effect on layout parameters instantly.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDeletedList(!showDeletedList)}
                className={`px-3 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  showDeletedList 
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                    : 'bg-white/5 hover:bg-white/10 text-slate-400 border border-white/10'
                }`}
              >
                <Lock className="w-3.5 h-3.5 text-rose-400" />
                Blocked Sync Notes ({deletedEntities.length})
              </button>

              <div className="relative w-full md:w-64">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search nodes by title/tag..."
                  value={nodeSearch}
                  onChange={(e) => setNodeSearch(e.target.value)}
                  className="w-full bg-[#0a0c10] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Nodes Table UI */}
          <div className="bg-[#0a0c10]/40 border border-white/5 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-[#0c0e12] text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                    <th className="p-4 font-semibold">Note / Node Title</th>
                    <th className="p-4 font-semibold">Domain/Cluster</th>
                    <th className="p-4 font-semibold">Sub-Cluster</th>
                    <th className="p-4 font-semibold">Metadata</th>
                    <th className="p-4 font-semibold">Relevance</th>
                    <th className="p-4 font-semibold text-center">Map Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                  {filteredNodes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-500 font-mono italic">
                        No database nodes match your search query.
                      </td>
                    </tr>
                  ) : (
                    filteredNodes.map(node => {
                      const nodeColor = clusters.find(c => c.name === node.domain)?.color || '#6366f1';
                      const subIdxOptions = getSubClusterOptions(node.domain, node.id);
                      const computedInfo = getEntitySubClusterInfo(node);
                      
                      return (
                        <tr key={node.id} className="hover:bg-white/[0.01] transition-colors">
                          {/* Note Title & File icon */}
                          <td className="p-4 font-semibold text-slate-200">
                            <div className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-slate-400" />
                                {node.title}
                              </span>
                              <span className="text-[9px] font-mono text-slate-600 uppercase">ID: {node.id}</span>
                            </div>
                          </td>

                          {/* Domain / Continent Select Dropdown */}
                          <td className="p-4">
                            <div className="relative inline-block">
                              <select
                                value={node.domain}
                                onChange={(e) => handleNodeClusterChange(node.id, e.target.value)}
                                className="bg-[#07090c] border border-white/10 hover:border-indigo-500/40 rounded px-2.5 py-1.5 text-[10px] font-mono uppercase text-slate-300 focus:outline-none cursor-pointer transition-colors"
                                style={{ color: nodeColor }}
                              >
                                {clusters.map(c => (
                                  <option key={c.name} value={c.name} className="bg-[#050608] text-slate-300">
                                    {c.name.toUpperCase()}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Sub-cluster Selection */}
                          <td className="p-4">
                            {subIdxOptions.length > 0 ? (
                              <select
                                value={node.sub_idx !== null && node.sub_idx !== undefined ? node.sub_idx : 'auto'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleNodeSubClusterChange(node.id, val === 'auto' ? null : Number(val));
                                }}
                                className="bg-[#07090c] border border-white/10 hover:border-indigo-500/40 rounded px-2 py-1.5 text-[10px] font-mono text-slate-300 focus:outline-none cursor-pointer transition-colors"
                              >
                                <option value="auto" className="bg-[#050608] text-indigo-400 font-semibold italic">AUTOMATIC ({computedInfo.title})</option>
                                {subIdxOptions.map(sc => (
                                  <option key={sc.sub_idx} value={sc.sub_idx} className="bg-[#050608]">
                                    {sc.title}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[10px] font-mono text-slate-600">SEC-01 (Fixed)</span>
                            )}
                          </td>

                          {/* Level/Scale & Type Badge */}
                          <td className="p-4 font-mono text-[10px]">
                            <div className="flex flex-col gap-1 max-w-[120px]">
                              <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 text-center uppercase text-[9px]">
                                SCALE: {node.scale}
                              </span>
                              {node.type && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/5 border border-amber-500/10 text-amber-400 text-center uppercase text-[9px]">
                                  TYPE: {node.type}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Relevance score slider or value */}
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-indigo-400">{node.relevance ?? 0}%</span>
                              <div className="w-16 bg-white/5 h-1 rounded-full overflow-hidden">
                                <div 
                                  className="bg-indigo-500 h-full rounded-full" 
                                  style={{ width: `${node.relevance ?? 0}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Map Action: Switch back to Explorer, focus, or delete */}
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  selectEntity(node.id);
                                  setStatusMessage(`Focused node: ${node.title}. Switch to the Explorer tab at the top to view its position on the active garden topology!`);
                                  setTimeout(() => setStatusMessage(null), 5000);
                                }}
                                className="px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 transition-all cursor-pointer inline-flex items-center gap-1"
                                title="Focus node on map"
                              >
                                Focus
                              </button>
                              <button
                                onClick={() => setNodeToDelete({ id: node.id, title: node.title })}
                                className="px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 hover:text-rose-300 transition-all cursor-pointer inline-flex items-center gap-1"
                                title="Delete note & block from future file syncs"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Blocked / Sync-Excluded Notes Panel */}
          {showDeletedList && (
            <div className="mt-6 bg-[#0a0c10]/80 border border-rose-500/20 rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-bold text-rose-300 font-mono tracking-wider uppercase">
                    Blocked / Sync-Excluded Notes ({deletedEntities.length})
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  These notes were deleted from the database and will be automatically skipped during GitHub syncs.
                </span>
              </div>

              {deletedEntities.length === 0 ? (
                <div className="py-6 text-center text-slate-500 font-mono text-xs italic">
                  No notes currently blocked from sync.
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-72 overflow-y-auto pr-1">
                  {deletedEntities.map((item) => (
                    <div key={item.id} className="py-2.5 flex items-center justify-between text-xs hover:bg-white/[0.01] px-2 rounded">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-rose-400/80" />
                          {item.title || item.filename}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {item.relative_path || item.filename} • Deleted: {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : 'Recently'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRestoreDeletedNode(item.id, item.title || item.filename)}
                        disabled={restoringEntityId === item.id}
                        className="px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      >
                        {restoringEntityId === item.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Unblock Sync
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}


      {/* ======================= SUB-TAB 3: DATABASE RELATIONSHIPS MANAGER ======================= */}
      {activeTab === 'links' && (
        <div className="p-8 pb-24 flex flex-col lg:flex-row gap-8 flex-1 max-w-6xl">
          {/* Main active links list (Left 2/3) */}
          <div className="flex-1 flex flex-col min-w-0 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-slate-500 font-mono tracking-wider uppercase">Active Live Edges (`relationships` table)</span>
                <p className="text-xs text-slate-400">
                  Inspect and directly delete or type-edit direct/active connections currently visible on the garden graph explorer.
                </p>
              </div>

              <div className="relative w-full md:w-60 flex-shrink-0">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search relationships..."
                  value={relationshipSearch}
                  onChange={(e) => setRelationshipSearch(e.target.value)}
                  className="w-full bg-[#0a0c10] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                />
              </div>
            </div>

            {/* Table 1: Node Links */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-200">
                  Active Node Links ({nodeRelationships.length})
                </h3>
              </div>
              <div className="bg-[#0a0c10]/40 border border-white/5 rounded-xl overflow-hidden shadow-xl">
                <div className="overflow-y-auto max-h-[320px]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0c0e12] text-[10px] font-mono text-slate-500 uppercase tracking-widest sticky top-0 z-10">
                        <th className="p-4 font-semibold">Source Node</th>
                        <th className="p-4 font-semibold">Relationship Type</th>
                        <th className="p-4 font-semibold">Target Node</th>
                        <th className="p-4 font-semibold text-center">Manage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                      {nodeRelationships.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500 font-mono italic">
                            No active node relationships found.
                          </td>
                        </tr>
                      ) : (
                        nodeRelationships.map(rel => (
                          <tr key={rel.id} className="hover:bg-white/[0.01] transition-colors">
                            {/* Source Note */}
                            <td className="p-4 font-semibold text-slate-200">
                              <span className="flex items-center gap-1.5 truncate max-w-[160px]" title={getEntityTitle(rel.source)}>
                                <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                                <span className="truncate">{getEntityTitle(rel.source)}</span>
                              </span>
                            </td>

                            {/* Relation Type Dropdown selector & Visibility mode dropdown */}
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <select
                                  value={rel.type}
                                  onChange={(e) => handleConfirmType(rel.id, e.target.value)}
                                  className={`bg-[#07090c] border border-white/10 rounded px-2 py-1 text-[10px] font-mono uppercase focus:outline-none cursor-pointer transition-colors ${getTypeColor(rel.type)}`}
                                >
                                  {RELATIONSHIP_TYPES.map(t => (
                                    <option key={t} value={t} className="bg-[#050608] text-slate-300 uppercase text-[9px]">
                                      {t.replace('_', ' ')}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={isSoftLink(rel) ? 'soft_link' : (rel.visible ? 'visible' : 'hidden')}
                                  onChange={async (e) => {
                                    const val = e.target.value;
                                    const isSoft = val === 'soft_link';
                                    let currentEv = rel.evidence || '';
                                    if (isSoft) {
                                      if (!currentEv.toLowerCase().includes('[soft: true]')) {
                                        currentEv = `${currentEv} [Soft: true]`.trim();
                                      }
                                    } else {
                                      currentEv = currentEv.replace(/\[soft:\s*true\]/gi, '').replace(/\[style:\s*soft\]/gi, '').trim();
                                    }
                                    await fetch('/api/relationships/update', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        id: rel.id,
                                        type: rel.type,
                                        evidence: currentEv,
                                        visible: val !== 'hidden'
                                      })
                                    });
                                    await fetchGraph();
                                  }}
                                  className="bg-[#07090c] border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-slate-300 focus:outline-none cursor-pointer transition-colors"
                                >
                                  <option value="visible">visible</option>
                                  <option value="soft_link">soft link</option>
                                  <option value="hidden">not visible</option>
                                </select>
                              </div>
                            </td>

                            {/* Target Note */}
                            <td className="p-4 font-semibold text-slate-200">
                              <span className="flex items-center gap-1.5 truncate max-w-[160px]" title={getEntityTitle(rel.target)}>
                                <FileText className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                                <span className="truncate">{getEntityTitle(rel.target)}</span>
                              </span>
                            </td>

                            {/* Delete Link button */}
                            <td className="p-4 text-center">
                              <button
                                onClick={() => handleDeleteRelationship(rel.id)}
                                title="Delete relationship"
                                className="p-1.5 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Table 2: Sub-Cluster Links */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-200">
                  Active Sub-Cluster Links ({subClusterRelationships.length})
                </h3>
              </div>
              <div className="bg-[#0a0c10]/40 border border-white/5 rounded-xl overflow-hidden shadow-xl">
                <div className="overflow-y-auto max-h-[320px]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0c0e12] text-[10px] font-mono text-slate-500 uppercase tracking-widest sticky top-0 z-10">
                        <th className="p-4 font-semibold">Source Sub-Cluster</th>
                        <th className="p-4 font-semibold">Relationship Type</th>
                        <th className="p-4 font-semibold">Target Sub-Cluster</th>
                        <th className="p-4 font-semibold text-center">Manage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                      {subClusterRelationships.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500 font-mono italic">
                            No active sub-cluster relationships found. Use the Connect Tool on sub-cluster outlines or create a link manually!
                          </td>
                        </tr>
                      ) : (
                        subClusterRelationships.map(rel => (
                          <tr key={rel.id} className="hover:bg-white/[0.01] transition-colors">
                            {/* Source Sub-Cluster */}
                            <td className="p-4 font-semibold text-slate-200">
                              <span className="flex items-center gap-1.5 truncate max-w-[200px]" title={getEntityTitle(rel.source)}>
                                <Layers className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                                <span className="truncate">{getEntityTitle(rel.source)}</span>
                              </span>
                            </td>

                            {/* Relation Type Dropdown selector & Visible checkbox */}
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <select
                                  value={rel.type}
                                  onChange={(e) => handleConfirmType(rel.id, e.target.value)}
                                  className={`bg-[#07090c] border border-white/10 rounded px-2 py-1 text-[10px] font-mono uppercase focus:outline-none cursor-pointer transition-colors ${getTypeColor(rel.type)}`}
                                >
                                  {RELATIONSHIP_TYPES.map(t => (
                                    <option key={t} value={t} className="bg-[#050608] text-slate-300 uppercase text-[9px]">
                                      {t.replace('_', ' ')}
                                    </option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-1 cursor-pointer bg-white/5 hover:bg-white/10 px-2 py-1 rounded border border-white/10 transition-colors" title="Toggle line visibility on map">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(rel.visible)}
                                    onChange={(e) => handleToggleVisibility(rel.id, e.target.checked)}
                                    className="w-3 h-3 rounded border-white/20 bg-[#07090c] text-indigo-500 focus:ring-0 cursor-pointer"
                                  />
                                  <span className="text-[10px] font-mono text-slate-300">visible?</span>
                                </label>
                              </div>
                            </td>

                            {/* Target Sub-Cluster */}
                            <td className="p-4 font-semibold text-slate-200">
                              <span className="flex items-center gap-1.5 truncate max-w-[200px]" title={getEntityTitle(rel.target)}>
                                <Layers className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                                <span className="truncate">{getEntityTitle(rel.target)}</span>
                              </span>
                            </td>

                            {/* Delete Link button */}
                            <td className="p-4 text-center">
                              <button
                                onClick={() => handleDeleteRelationship(rel.id)}
                                title="Delete relationship"
                                className="p-1.5 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Form to Create Relationship Manually (Right 1/3) */}
          <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-6">
            <div className="bg-[#0a0c10]/40 border border-white/5 p-6 rounded-xl shadow-xl flex flex-col gap-4">
              <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                <PlusCircle className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Create Direct Link</h3>
              </div>

              {/* Category Selector */}
              <div className="flex bg-[#07090c] p-1 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setManualLinkCategory('node');
                    setManualSource('');
                    setManualTarget('');
                  }}
                  className={`flex-1 py-1.5 rounded text-[11px] font-mono font-bold uppercase transition-all cursor-pointer ${
                    manualLinkCategory === 'node'
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Node Link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setManualLinkCategory('subcluster');
                    setManualSource('');
                    setManualTarget('');
                  }}
                  className={`flex-1 py-1.5 rounded text-[11px] font-mono font-bold uppercase transition-all cursor-pointer ${
                    manualLinkCategory === 'subcluster'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Sub-Cluster Link
                </button>
              </div>

              <p className="text-[11px] text-slate-500 font-mono uppercase tracking-tight">
                {manualLinkCategory === 'node'
                  ? 'Instantly map a manual relationship between any two nodes.'
                  : 'Instantly map a relationship between two sub-clusters.'}
              </p>

              <form onSubmit={handleCreateManualRelationship} className="flex flex-col gap-4 mt-1">
                {/* Source Select */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase">
                    {manualLinkCategory === 'node' ? 'Source Note' : 'Source Sub-Cluster'}
                  </label>
                  <select
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value)}
                    className="w-full bg-[#0a0c10] border border-white/10 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                  >
                    <option value="">
                      {manualLinkCategory === 'node' ? '-- SELECT SOURCE NODE --' : '-- SELECT SOURCE SUB-CLUSTER --'}
                    </option>
                    {manualLinkCategory === 'node'
                      ? entities.map(e => (
                          <option key={e.id} value={e.id}>{e.title}</option>
                        ))
                      : allSubClusterOptions.map(sc => (
                          <option key={sc.id} value={sc.id}>{sc.title}</option>
                        ))}
                  </select>
                </div>

                {/* Type Select and Visibility Dropdown */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono text-slate-500 font-bold uppercase">Relationship Type</label>
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value)}
                      className="w-full bg-[#0a0c10] border border-white/10 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200 font-mono uppercase"
                    >
                      {RELATIONSHIP_TYPES.map(t => (
                        <option key={t} value={t}>{t.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col justify-end pt-5">
                    <select
                      value={manualVisibilityMode}
                      onChange={(e) => setManualVisibilityMode(e.target.value as 'visible' | 'soft_link' | 'not_visible')}
                      className="bg-[#0a0c10] border border-white/10 rounded px-2.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="visible">visible</option>
                      <option value="soft_link">soft link</option>
                      <option value="not_visible">not visible</option>
                    </select>
                  </div>
                </div>

                {/* Target Select */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase">
                    {manualLinkCategory === 'node' ? 'Target Note' : 'Target Sub-Cluster'}
                  </label>
                  <select
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    className="w-full bg-[#0a0c10] border border-white/10 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                  >
                    <option value="">
                      {manualLinkCategory === 'node' ? '-- SELECT TARGET NODE --' : '-- SELECT TARGET SUB-CLUSTER --'}
                    </option>
                    {manualLinkCategory === 'node'
                      ? entities.map(e => (
                          <option key={e.id} value={e.id}>{e.title}</option>
                        ))
                      : allSubClusterOptions.map(sc => (
                          <option key={sc.id} value={sc.id}>{sc.title}</option>
                        ))}
                  </select>
                </div>

                {/* Optional Evidence context */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase">Evidence / Memo (Optional)</label>
                  <textarea
                    rows={3}
                    placeholder="Provide evidence or a reasoning memo..."
                    value={manualEvidence}
                    onChange={(e) => setManualEvidence(e.target.value)}
                    className="w-full bg-[#0a0c10] border border-white/10 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200 resize-none"
                  />
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isCreatingManual || !manualSource || !manualTarget}
                  className="w-full py-2.5 rounded text-xs font-bold uppercase tracking-wider bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-400 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1.5 mt-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  {isCreatingManual ? 'Creating...' : 'Establish Link'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}


      {/* ======================= SUB-TAB 4: SNAPSHOTS & BACKUPS ======================= */}
      {activeTab === 'snapshots' && (
        !isEditUnlocked ? (
          <div className="flex-1 flex items-center justify-center p-8 pb-24">
            <div className="bg-[#0a0c10]/60 border border-white/10 p-8 rounded-xl max-w-sm w-full mx-auto shadow-2xl flex flex-col gap-6 backdrop-blur-md relative">
              <div className="flex flex-col gap-2 text-center">
                <span className="text-xs font-mono text-indigo-400 uppercase tracking-widest flex items-center justify-center gap-1.5 mb-1">
                  <Lock className="w-4 h-4 animate-pulse text-indigo-400" /> Backups Session Locked
                </span>
                <h3 className="text-lg font-sans font-medium text-slate-100 font-bold">Gardener Authentication</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Enter the gardener passphrase to access database snapshots, restore backups, and manage historical archives.
                </p>
              </div>
              
              <div className="flex flex-col gap-3">
                <input
                  type="password"
                  placeholder="Passphrase"
                  autoFocus
                  value={backupPasswordInput}
                  onChange={(e) => {
                    setBackupPasswordInput(e.target.value);
                    setBackupPassError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (backupPasswordInput === 'c4ss.garden') {
                        setEditUnlocked(true);
                        setBackupPassError(false);
                        setBackupPasswordInput('');
                        showFeedback("Database snapshots unlocked successfully.");
                      } else {
                        setBackupPassError(true);
                      }
                    }
                  }}
                  className={`w-full bg-[#050608] border rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors text-center font-mono ${backupPassError ? 'border-red-500/50 focus:border-red-500' : 'border-white/10'}`}
                />
                {backupPassError && (
                  <span className="text-[10px] text-red-400 text-center font-mono animate-pulse">
                    Incorrect passphrase
                  </span>
                )}
              </div>

              <button
                onClick={() => {
                  if (backupPasswordInput === 'c4ss.garden') {
                    setEditUnlocked(true);
                    setBackupPassError(false);
                    setBackupPasswordInput('');
                    showFeedback("Database snapshots unlocked successfully.");
                  } else {
                    setBackupPassError(true);
                  }
                }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans shadow-lg shadow-indigo-600/20"
              >
                Authenticate
              </button>
            </div>
          </div>
        ) : (
          <div className="p-8 pb-24 flex flex-col lg:flex-row gap-8 flex-1 max-w-6xl">
            {/* Snapshots List (Left 2/3) */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex flex-col gap-1 mb-6">
                <span className="text-[10px] font-bold text-slate-500 font-mono tracking-wider uppercase">Saved Snapshots Directory</span>
                <p className="text-xs text-slate-400">
                  View, restore, or manage database snapshots. Restoring a snapshot will immediately revert entities, relationships, sub-clusters, and layout geometries to the saved state.
                </p>
              </div>

              {/* Snapshots List Table */}
              <div className="bg-[#0a0c10]/40 border border-white/5 rounded-xl overflow-hidden shadow-xl flex-1">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0c0e12] text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                        <th className="p-4 font-semibold">Snapshot Name / Label</th>
                        <th className="p-4 font-semibold">Created Timestamp</th>
                        <th className="p-4 font-semibold">Database Content Stats</th>
                        <th className="p-4 font-semibold text-right pr-6">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                      {snapshots.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-12 text-center text-slate-500 font-mono italic">
                            No database snapshots saved yet. Create your first snapshot using the panel to secure your current state!
                          </td>
                        </tr>
                      ) : (
                        snapshots.map(snap => {
                          const dateStr = new Date(snap.timestamp).toLocaleString();
                          const kbSize = (snap.sizeBytes / 1024).toFixed(1);
                          return (
                            <tr key={snap.filename} className="hover:bg-white/[0.01] transition-colors">
                              {/* Snapshot Title */}
                              <td className="p-4 font-semibold text-slate-200">
                                <div className="flex flex-col gap-0.5">
                                  <span className="flex items-center gap-1.5 text-indigo-300">
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    {snap.name}
                                  </span>
                                  <span className="text-[9px] font-mono text-slate-600 uppercase max-w-[240px] truncate" title={snap.filename}>
                                    File: {snap.filename}
                                  </span>
                                </div>
                              </td>

                              {/* Timestamp */}
                              <td className="p-4 font-mono text-slate-400 text-[11px]">
                                {dateStr}
                              </td>

                              {/* Database Stats */}
                              <td className="p-4 font-mono text-[10px]">
                                <div className="flex flex-col gap-1">
                                  <span className="text-slate-400 uppercase text-[9px] flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    Nodes: <strong className="text-slate-200">{snap.entityCount}</strong>
                                  </span>
                                  <span className="text-slate-400 uppercase text-[9px] flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                    Links: <strong className="text-slate-200">{snap.relationshipCount}</strong> (Pending: <strong className="text-slate-400">{snap.pendingCount}</strong>)
                                  </span>
                                  <span className="text-slate-500 text-[9px] uppercase">
                                    Size: {kbSize} KB
                                  </span>
                                </div>
                              </td>

                              {/* Manage buttons */}
                              <td className="p-4 text-right pr-6">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => triggerRestoreSnapshot(snap.filename, snap.name)}
                                    disabled={restoringSnapshot !== null}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/20 text-indigo-400 transition-all cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
                                  >
                                    {restoringSnapshot === snap.filename ? 'Reverting...' : 'Revert state'}
                                  </button>
                                  <a
                                    href={`/api/backup/download-snapshot/${snap.filename}`}
                                    download={snap.filename}
                                    title="Download snapshot JSON"
                                    className="p-1.5 rounded hover:bg-slate-500/15 text-slate-400 hover:text-slate-200 border border-transparent hover:border-slate-500/20 transition-all cursor-pointer inline-flex items-center justify-center"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                  <button
                                    onClick={() => triggerDeleteSnapshot(snap.filename, snap.name)}
                                    disabled={deletingSnapshot !== null}
                                    title="Delete snapshot"
                                    className="p-1.5 rounded hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer disabled:opacity-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Form to Save Snapshot (Right 1/3) */}
            <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-6">
              <div className="bg-[#0a0c10]/40 border border-white/5 p-6 rounded-xl shadow-xl flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                  <RotateCcw className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Save Snapshot</h3>
                </div>
                <p className="text-[11px] text-slate-500 font-mono uppercase tracking-tight">
                  Capture the entire current state of all database nodes, customized relationship types, pending review queues, and sub-cluster geometries.
                </p>

                <form onSubmit={handleCreateSnapshot} className="flex flex-col gap-4 mt-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono text-slate-500 font-bold uppercase">Snapshot Title / Memo</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Before manual relationship revisions"
                      value={newSnapshotName}
                      onChange={(e) => setNewSnapshotName(e.target.value)}
                      className="w-full bg-[#0a0c10] border border-white/10 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isCreatingSnapshot || !newSnapshotName.trim()}
                    className="w-full py-2.5 rounded text-xs font-bold uppercase tracking-wider bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-400 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1.5 mt-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {isCreatingSnapshot ? 'Saving...' : 'Capture Snapshot'}
                  </button>
                </form>
              </div>

              {/* Download Backups Card */}
              <div className="bg-[#0a0c10]/40 border border-white/5 p-6 rounded-xl shadow-xl flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                  <Download className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Manage Backups</h3>
                </div>
                <p className="text-[11px] text-slate-500 font-mono uppercase tracking-tight">
                  Securely download your permanent database files directly, or import snapshot backups.
                </p>
                <div className="flex flex-col gap-3 mt-2">
                  <a
                    href="/api/backup/download-all-snapshots"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-400 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Download All Snapshots (.json)
                  </a>
                  <a
                    href="/api/backup/download-db"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Download atlas.db (SQLite)
                  </a>
                  <a
                    href="/api/backup/download-json"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Download backup_atlas.json
                  </a>
                  
                  <div className="h-px bg-white/5 my-2"></div>
                  
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    className="w-full py-2.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    {isImporting ? 'Importing...' : 'Import Snapshot'}
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImportSnapshot}
                    accept=".json"
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* Custom Confirmation Modals */}
      {confirmRestoreFile && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0b0d13] border border-indigo-500/30 p-6 rounded-xl max-w-md w-full mx-4 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-wider text-sm border-b border-white/5 pb-2">
              <RotateCcw className="w-5 h-5 text-indigo-400" />
              Revert Database State?
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you absolutely sure you want to restore the snapshot <strong className="text-indigo-300">"{confirmRestoreName}"</strong>? This will completely overwrite the current live database state. All custom-placed nodes, links, and layout edits made since this snapshot will be reverted.
            </p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => { setConfirmRestoreFile(null); setConfirmRestoreName(''); }}
                className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
              >
                Revert Now
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteFile && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0b0d13] border border-rose-500/30 p-6 rounded-xl max-w-md w-full mx-4 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center gap-2 text-rose-400 font-bold uppercase tracking-wider text-sm border-b border-white/5 pb-2">
              <Trash2 className="w-5 h-5 text-rose-400" />
              Delete Snapshot File?
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete <strong className="text-rose-300">"{confirmDeleteName}"</strong>? This snapshot file will be deleted from disk and cannot be recovered.
            </p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => { setConfirmDeleteFile(null); setConfirmDeleteName(''); }}
                className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {nodeToDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0b0d13] border border-rose-500/30 p-6 rounded-xl max-w-md w-full mx-4 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center gap-2 text-rose-400 font-bold uppercase tracking-wider text-sm border-b border-white/5 pb-2">
              <Trash2 className="w-5 h-5 text-rose-400" />
              Delete Note & Block Sync
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to delete <strong className="text-rose-300">"{nodeToDelete.title}"</strong> from the database?
            </p>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-[11px] text-rose-300/90 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-rose-400">
                <AlertCircle className="w-3.5 h-3.5" /> What happens when deleted:
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>Removed permanently from live graph & database entities table.</li>
                <li>Associated markdown file (if present) will be removed.</li>
                <li><strong>Blocked from future sync:</strong> Subsequent GitHub file syncs will automatically skip this note.</li>
              </ul>
            </div>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setNodeToDelete(null)}
                disabled={isDeletingNode}
                className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteNode}
                disabled={isDeletingNode}
                className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingNode ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete & Block Note
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

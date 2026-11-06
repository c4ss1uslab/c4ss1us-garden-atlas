import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useMapStore } from '../store';
import { Entity, Relationship, isSoftLink } from '../types';
import { Link2, X, Sparkles, Plus, Check, FileText, ArrowRight, Trash2, Eye, EyeOff } from 'lucide-react';

const ENTITY_TYPES = [
  { key: 'actors', tags: ['person', 'organization', 'community', 'network'] },
  { key: 'projects', tags: ['project', 'tool', 'prototype', 'experiment'] },
  { key: 'knowledge', tags: ['concept', 'framework', 'pattern', 'topic'] },
  { key: 'sources', tags: ['article', 'book', 'paper', 'podcast', 'video', 'website', 'highlights', 'highlight'] },
  { key: 'original', tags: ['c4ss1us', 'l1f3'] },
];

const SOURCE_TAGS = ['article', 'book', 'paper', 'podcast', 'video', 'website', 'highlights', 'highlight', 'source', 'sources'];

const isSourceEntity = (entity: Entity): boolean => {
  if (!entity) return false;
  const normalizedType = (entity.type || '').toLowerCase();
  if (SOURCE_TAGS.includes(normalizedType)) return true;
  const tags = (entity.tags || []).map(t => t.replace(/^#/, '').toLowerCase());
  return tags.some(t => SOURCE_TAGS.includes(t));
};

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

const getEntityRadius = (entity: any): number => {
  const contentLength = (entity.content || '').length;
  if (contentLength >= 2500) {
    return 12; // Large
  } else if (contentLength >= 600) {
    return 8; // Medium
  }
  return 5; // Small
};

const closestPointOnSegment = (p: [number, number], p1: [number, number], p2: [number, number]): [number, number] => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return [p1[0], p1[1]];

  let t = ((p[0] - p1[0]) * dx + (p[1] - p1[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return [p1[0] + t * dx, p1[1] + t * dy];
};

const getClosestPointOnPolygon = (p: [number, number], vertices: [number, number][]): { point: [number, number]; distSq: number } => {
  let minDistSq = Infinity;
  let bestPoint: [number, number] = [vertices[0][0], vertices[0][1]];

  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % n];
    const proj = closestPointOnSegment(p, p1, p2);
    const distSq = (p[0] - proj[0]) ** 2 + (p[1] - proj[1]) ** 2;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      bestPoint = proj;
    }
  }

  return { point: bestPoint, distSq: minDistSq };
};

const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
};

const parseRelEvidenceAndPos = (rel: any) => {
  const rawEvidence = rel?.evidence || '';
  let style: 'solid' | 'dotted' = 'solid';
  if (rawEvidence.toLowerCase().includes('dotted') || (rel?.type && rel.type.toLowerCase().includes('dotted'))) {
    style = 'dotted';
  }
  
  let sourcePos: { x: number; y: number } | null = null;
  let targetPos: { x: number; y: number } | null = null;
  
  const posMatch = rawEvidence.match(/\[Pos:\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s*->\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s*\]/);
  if (posMatch) {
    sourcePos = { x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]) };
    targetPos = { x: parseFloat(posMatch[3]), y: parseFloat(posMatch[4]) };
  } else if (rel?.sourceX !== undefined && rel?.sourceY !== undefined && rel?.targetX !== undefined && rel?.targetY !== undefined) {
    sourcePos = { x: rel.sourceX, y: rel.sourceY };
    targetPos = { x: rel.targetX, y: rel.targetY };
  }

  const cleanEvidence = rawEvidence
    .replace(/\[Style:\s*(solid|dotted)\]/gi, '')
    .replace(/\[Pos:\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s*->\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s*\]/gi, '')
    .trim();

  return { style, cleanEvidence, sourcePos, targetPos };
};

const getClusterVertices = (
  clusterEntities: Entity[], 
  centerX: number, 
  centerY: number, 
  padding = 140,
  extraPoints?: [number, number][]
): [number, number][] => {
  let points: [number, number][] = [];
  
  if (clusterEntities.length === 0 && (!extraPoints || extraPoints.length === 0)) {
    const r = padding * 1.1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      points.push([
        centerX + Math.cos(a) * r,
        centerY + Math.sin(a) * r
      ]);
    }
  } else {
    clusterEntities.forEach(e => {
      points.push([e.x, e.y]);
    });
    if (extraPoints) {
      extraPoints.forEach(p => {
        points.push([p[0], p[1]]);
      });
    }

    if (points.length === 1) {
      const p = points[0];
      const r = padding * 1.2;
      points = [];
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        points.push([
          p[0] + Math.cos(a) * r,
          p[1] + Math.sin(a) * r
        ]);
      }
    } else if (points.length === 2) {
      const p1 = points[0];
      const p2 = points[1];
      const r = padding * 1.0;
      points = [];
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        points.push([p1[0] + Math.cos(a) * r, p1[1] + Math.sin(a) * r]);
        points.push([p2[0] + Math.cos(a) * r, p2[1] + Math.sin(a) * r]);
      }
    }
  }

  const hull = d3.polygonHull(points);
  if (!hull) {
    const centroidX = d3.mean(points, p => p[0]) || centerX;
    const centroidY = d3.mean(points, p => p[1]) || centerY;
    const res: [number, number][] = [];
    const r = padding * 1.1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      res.push([
        centroidX + Math.cos(a) * r,
        centroidY + Math.sin(a) * r
      ]);
    }
    return res;
  }

  const centroidX = d3.mean(hull, p => p[0]) || centerX;
  const centroidY = d3.mean(hull, p => p[1]) || centerY;
  return hull.map(([x, y]) => {
    const dx = x - centroidX;
    const dy = y - centroidY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    return [
      x + (dist > 0 ? (dx / dist) * padding : 0),
      y + (dist > 0 ? (dy / dist) * padding : 0)
    ];
  });
};

const findBestLabelPosition = (
    subEntities: Entity[],
    centerX: number,
    centerY: number,
    activeEntities: Entity[],
    labelText: string,
    fontSize: number,
    t: d3.ZoomTransform,
    drawnSubClusterBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }>
) => {
    const labelWidth = labelText.length * fontSize * 0.55;
    const labelHeight = fontSize * 1.5; // Include minor label SEC-xx

    let maxNodeDist = 30;
    subEntities.forEach(e => {
        const d = Math.hypot(e.x - centerX, e.y - centerY);
        if (d > maxNodeDist) maxNodeDist = d;
    });

    // We try to place it at different angles outside the nodes
    const angles = [
        -Math.PI / 2,         // Above
        -Math.PI / 2 - 0.4,   // Above-left
        -Math.PI / 2 + 0.4,   // Above-right
        Math.PI / 2,          // Below
        Math.PI / 2 + 0.4,    // Below-left
        Math.PI / 2 - 0.4,    // Below-right
        -0.1,                 // Right
        Math.PI + 0.1         // Left
    ];

    const distances = [
        maxNodeDist + 24,
        maxNodeDist + 40,
        maxNodeDist + 60
    ];

    let bestX = centerX;
    let bestY = centerY - maxNodeDist - 25;
    let minPenalty = Infinity;

    const getAnglePreferencePenalty = (angle: number) => {
        const diff = Math.abs(angle - (-Math.PI / 2));
        return diff * 4.0; // Prefer above (top) over sides and bottom
    };

    for (const dist of distances) {
        for (const angle of angles) {
            const cx = centerX + Math.cos(angle) * dist;
            const cy = centerY + Math.sin(angle) * dist;

            let penalty = getAnglePreferencePenalty(angle);

            // Proposed label bounding box
            const l_x1 = cx - labelWidth / 2;
            const l_x2 = cx + labelWidth / 2;
            const l_y1 = cy - labelHeight / 2;
            const l_y2 = cy + labelHeight / 2;

            // 1. Overlap with nodes
            for (const node of activeEntities) {
                const radius = getEntityRadius(node);
                const distToNode = Math.hypot(cx - node.x, cy - node.y);
                const minAllowedDist = radius + 22;
                if (distToNode < minAllowedDist) {
                    penalty += Math.pow(minAllowedDist - distToNode, 2) * 8.0;
                }

                // 2. Overlap with node labels (if shown)
                let showNodeLabel = false;
                if (t.k >= 0.8) {
                    showNodeLabel = true;
                } else if (t.k >= 0.3) {
                    if (node.scale === 'landmark' || node.scale === 'city' || (node.relevance !== undefined && node.relevance >= 80)) {
                        showNodeLabel = true;
                    }
                } else {
                    if (node.scale === 'landmark' && t.k >= 0.05) {
                        showNodeLabel = true;
                    }
                }

                if (showNodeLabel) {
                    const nFontSize = node.scale === 'landmark' ? 14 / t.k : 10.5 / t.k;
                    const nCappedFontSize = Math.min(Math.max(nFontSize, 2), 40);
                    const nRadius = radius;
                    const nLabelX = node.x;
                    const nLabelY = node.y + nRadius + nCappedFontSize + 2 / t.k;
                    const nLabelWidth = node.title.length * nCappedFontSize * 0.55;
                    const nLabelHeight = nCappedFontSize;

                    const nl_x1 = nLabelX - nLabelWidth / 2;
                    const nl_x2 = nLabelX + nLabelWidth / 2;
                    const nl_y1 = nLabelY - nLabelHeight / 2;
                    const nl_y2 = nLabelY + nLabelHeight / 2;

                    const overlapX = Math.max(0, Math.min(l_x2, nl_x2) - Math.max(l_x1, nl_x1));
                    const overlapY = Math.max(0, Math.min(l_y2, nl_y2) - Math.max(l_y1, nl_y1));
                    if (overlapX > 0 && overlapY > 0) {
                        penalty += (overlapX * overlapY) * 15.0;
                    }
                }
            }

            // 3. Overlap with previously drawn sub-cluster label boxes
            for (const box of drawnSubClusterBoxes) {
                const overlapX = Math.max(0, Math.min(l_x2, box.x2) - Math.max(l_x1, box.x1));
                const overlapY = Math.max(0, Math.min(l_y2, box.y2) - Math.max(l_y1, box.y1));
                if (overlapX > 0 && overlapY > 0) {
                    penalty += (overlapX * overlapY) * 25.0; // extreme penalty for title-on-title
                }
            }

            if (penalty < minPenalty) {
                minPenalty = penalty;
                bestX = cx;
                bestY = cy;
            }
        }
    }

    return { x: bestX, y: bestY, width: labelWidth, height: labelHeight };
};

export default function AtlasCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { 
    entities, relationships, clusters, zoomLevel, setZoomLevel, 
    selectEntity, hoveredEntityId, hoverEntity, selectedEntityId,
    searchQuery, stageFilters, minRelevance, selectedDomains,
    selectedTypes, selectedTags, excludedSubTags, viewMode,
    subClusters, updateEntityCoordinatesInStore,
    isConnectToolActive, setConnectToolActive,
    connectLineStyle, setConnectLineStyle
  } = useMapStore();
  
  // Dragging refs for custom mouse layout interaction
  const isDraggingRef = useRef(false);
  const draggedEntityIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);

  // For sub-clusters dragging and rotating interaction
  const subClusterLabelMetricsRef = useRef<Array<{
    domain: string;
    subIdx: number;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
    color: string;
  }>>([]);
  
  const hoveredSubClusterRef = useRef<{ domain: string; subIdx: number; isRotateHandle?: boolean } | null>(null);
  const selectedSubClusterRef = useRef<{ domain: string; subIdx: number } | null>(null);
  const isDraggingSubClusterRef = useRef(false);
  const isRotatingSubClusterRef = useRef(false);
  const dragSubClusterStartOffsetRef = useRef({ x: 0, y: 0 });
  
  // Keep transform in a ref to avoid re-renders during fast panning/zooming
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  // Also keep window dimensions
  const dimsRef = useRef({ width: 0, height: 0 });
  const zoomBehaviorRef = useRef<any>(null);
  const prevSelectedDomainsRef = useRef<string[]>([]);
  
  const [isPanning, setIsPanning] = useState(false);

  // Smoothly re-center & re-scale canvas to focus on selected domain(s) when domain filter changes
  useEffect(() => {
    const prev = prevSelectedDomainsRef.current;
    const curr = selectedDomains;

    // Check if domain selection actually changed
    const isSame = prev.length === curr.length && prev.every(d => curr.includes(d));
    prevSelectedDomainsRef.current = curr;

    if (isSame) return;

    const canvas = canvasRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!canvas || !zoomBehavior) return;

    const container = containerRef.current;
    const { width, height } = dimsRef.current.width > 0 
      ? dimsRef.current 
      : (container ? container.getBoundingClientRect() : { width: 0, height: 0 });

    if (width <= 0 || height <= 0) return;

    if (curr.length > 0) {
      // Gather spatial bounds for all entities and cluster centers/outlines in selected domains
      const targetEntities = entities.filter(e => curr.includes(e.domain));
      const targetClusters = clusters.filter(c => curr.includes(c.name));

      let points: [number, number][] = [];

      targetEntities.forEach(e => points.push([e.x, e.y]));

      targetClusters.forEach(cluster => {
        const clusterEnts = entities.filter(e => e.domain === cluster.name);
        const outerVerts = getClusterVertices(clusterEnts, cluster.x, cluster.y, 230);
        outerVerts.forEach(v => points.push([v[0], v[1]]));
        points.push([cluster.x, cluster.y - 250]);
        points.push([cluster.x, cluster.y + 250]);
      });

      if (points.length === 0) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      points.forEach(([px, py]) => {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      });

      const margin = 80;
      minX -= margin;
      maxX += margin;
      minY -= margin;
      maxY += margin;

      const bboxWidth = Math.max(maxX - minX, 200);
      const bboxHeight = Math.max(maxY - minY, 200);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const paddingScreen = 100;
      const availWidth = Math.max(width - paddingScreen * 2, 200);
      const availHeight = Math.max(height - paddingScreen * 2, 200);

      const scaleX = availWidth / bboxWidth;
      const scaleY = availHeight / bboxHeight;
      let targetScale = Math.min(scaleX, scaleY);

      // Clamp target scale to a clean, comfortable viewing range
      targetScale = Math.min(Math.max(targetScale, 0.12), 1.2);

      const targetTx = width / 2 - centerX * targetScale;
      const targetTy = height / 2 - centerY * targetScale;

      const targetTransform = d3.zoomIdentity.translate(targetTx, targetTy).scale(targetScale);

      d3.select(canvas)
        .transition()
        .duration(750)
        .ease(d3.easeCubicOut)
        .call(zoomBehavior.transform, targetTransform);
    } else if (prev.length > 0 && curr.length === 0) {
      // Re-center on full world map view when domain filters cleared
      const targetTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.1);
      d3.select(canvas)
        .transition()
        .duration(750)
        .ease(d3.easeCubicOut)
        .call(zoomBehavior.transform, targetTransform);
    }
  }, [selectedDomains, entities, clusters]);

  // References for live simulation in graph mode
  const simNodesRef = useRef<any[]>([]);
  const simLinksRef = useRef<any[]>([]);
  const simulationRef = useRef<any>(null);

  // Area selection and multi-node dragging refs
  const isSelectingBoxRef = useRef(false);
  const selectionStartRef = useRef({ x: 0, y: 0 });
  const selectionEndRef = useRef({ x: 0, y: 0 });
  const selectedEntityIdsRef = useRef<Set<string>>(new Set());
  const activeEntitiesRef = useRef<any[]>([]);
  const dragStartCoordinatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Connect Tool (Edit Mode line creation) State and Refs
  const subClusterOutlinesRef = useRef<Array<{
    domain: string;
    subIdx: number;
    title: string;
    color: string;
    vertices: [number, number][];
    centerX: number;
    centerY: number;
    isChildSubSub: boolean;
  }>>([]);
  const hoveredSubClusterOutlineRef = useRef<{
    domain: string;
    subIdx: number;
    title: string;
    color: string;
    x: number;
    y: number;
    vertices: [number, number][];
  } | null>(null);
  const subClusterConnectionDotsRef = useRef<Array<{
    domain: string;
    subIdx: number;
    title: string;
    x: number;
    y: number;
    color: string;
  }>>([]);
  const hoveredSubClusterDotRef = useRef<{
    domain: string;
    subIdx: number;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const isDraggingConnectLineRef = useRef(false);

  const [connectSource, setConnectSource] = useState<{
    type: 'node' | 'subcluster';
    id?: string;
    domain?: string;
    subIdx?: number;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const connectSourceRef = useRef<typeof connectSource>(null);

  const updateConnectSource = (src: typeof connectSource) => {
    connectSourceRef.current = src;
    setConnectSource(src);
  };

  const mouseWorldPosRef = useRef<{ x: number; y: number } | null>(null);

  const renderedLinksRef = useRef<Array<{
    rel: any;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>>([]);
  const hoveredRelationshipRef = useRef<any | null>(null);

  // Relationship Creation / Edit Modal State
  const [relationshipModal, setRelationshipModal] = useState<{
    isOpen: boolean;
    isEdit?: boolean;
    relId?: string;
    sourceEntity: { id: string; title: string };
    targetEntity: { id: string; title: string };
    sourcePos?: { x: number; y: number };
    targetPos?: { x: number; y: number };
    defaultStyle?: 'solid' | 'dotted';
  } | null>(null);

  const [modalType, setModalType] = useState('references');
  const [modalEvidence, setModalEvidence] = useState('');
  const [modalStyle, setModalStyle] = useState<'solid' | 'dotted'>('solid');
  const [modalVisible, setModalVisible] = useState(true);
  const [modalVisibilityMode, setModalVisibilityMode] = useState<'visible' | 'soft_link' | 'not_visible'>('visible');
  const [isSubmittingRel, setIsSubmittingRel] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const softLinkBadgeHitsRef = useRef<Array<{ entity: Entity; badgeX: number; badgeY: number; badgeRadius: number; softLinks: Relationship[] }>>([]);
  const hoveredSoftBadgeRef = useRef<{ entity: Entity; badgeX: number; badgeY: number; badgeRadius: number; softLinks: Relationship[] } | null>(null);
  const [linkModalData, setLinkModalData] = useState<{
    title: string;
    subtitle?: string;
    entity?: Entity;
    links: Relationship[];
  } | null>(null);

  const [activeLineLabelRelId, setActiveLineLabelRelId] = useState<string | null>(null);
  const activeLineLabelRelIdRef = useRef<string | null>(null);

  const [showRelationshipLines, setShowRelationshipLines] = useState(true);
  const showRelationshipLinesRef = useRef(true);
  const [isEyeBtnHovered, setIsEyeBtnHovered] = useState(false);

  // Open modal to edit existing relationship
  const openEditRelationshipModal = (rel: any) => {
    const srcId = typeof rel.source === 'object' ? rel.source.id : rel.source;
    const tgtId = typeof rel.target === 'object' ? rel.target.id : rel.target;

    const resolveItemTitle = (itemId: string) => {
      if (typeof itemId === 'string' && itemId.startsWith('subcluster:')) {
        const parts = itemId.split(':');
        const domain = parts[1];
        const subIdx = Number(parts[2]);
        const sc = useMapStore.getState().subClusters.find(s => s.domain === domain && s.sub_idx === subIdx);
        if (sc && sc.title) return `${domain} › ${sc.title}`;
        const outline = subClusterOutlinesRef.current.find(o => o.domain === domain && o.subIdx === subIdx);
        if (outline && outline.title) return `${domain} › ${outline.title}`;
        return `${domain} Sub-cluster`;
      }
      const ent = useMapStore.getState().entities.find(e => e.id === itemId);
      return ent ? ent.title : itemId;
    };

    const parsed = parseRelEvidenceAndPos(rel);

    setRelationshipModal({
      isOpen: true,
      isEdit: true,
      relId: rel.id,
      sourceEntity: { id: srcId, title: resolveItemTitle(srcId) },
      targetEntity: { id: tgtId, title: resolveItemTitle(tgtId) },
      sourcePos: parsed.sourcePos || undefined,
      targetPos: parsed.targetPos || undefined,
      defaultStyle: parsed.style
    });
    setModalStyle(parsed.style);
    setModalType(rel.type || 'references');
    setModalEvidence(parsed.cleanEvidence);
    setModalVisible(rel.visible !== false);
    if (rel.visible === false) {
      setModalVisibilityMode('not_visible');
    } else if (isSoftLink(rel)) {
      setModalVisibilityMode('soft_link');
    } else {
      setModalVisibilityMode('visible');
    }
  };

  // Complete relationship creation helper
  const handleCompleteConnection = (targetItem: {
    type: 'node' | 'subcluster';
    id?: string;
    domain?: string;
    subIdx?: number;
    title: string;
    x: number;
    y: number;
  }) => {
    const activeSource = connectSourceRef.current || connectSource;
    if (!activeSource) return;

    // Resolve source entity or subcluster
    const sourceEntity = activeSource.type === 'node'
      ? { id: activeSource.id!, title: activeSource.title }
      : { 
          id: `subcluster:${activeSource.domain}:${activeSource.subIdx}`, 
          title: activeSource.title ? `${activeSource.domain} › ${activeSource.title}` : `${activeSource.domain} Sub-cluster`
        };

    // Resolve target entity or subcluster
    const targetEntity = targetItem.type === 'node'
      ? { id: targetItem.id!, title: targetItem.title }
      : { 
          id: `subcluster:${targetItem.domain}:${targetItem.subIdx}`, 
          title: targetItem.title ? `${targetItem.domain} › ${targetItem.title}` : `${targetItem.domain} Sub-cluster`
        };

    if (sourceEntity && targetEntity && sourceEntity.id !== targetEntity.id) {
      setRelationshipModal({
        isOpen: true,
        isEdit: false,
        sourceEntity,
        targetEntity,
        sourcePos: { x: activeSource.x, y: activeSource.y },
        targetPos: { x: targetItem.x, y: targetItem.y },
        defaultStyle: connectLineStyle
      });
      setModalStyle(connectLineStyle);
      setModalType('references');
      setModalVisible(true);
      setModalVisibilityMode('visible');
      setModalEvidence('');
    }

    updateConnectSource(null);
  };

  // Delete relationship handler
  const handleDeleteRelationshipInModal = async () => {
    if (!relationshipModal || !relationshipModal.relId) return;
    setIsSubmittingRel(true);
    try {
      const res = await fetch('/api/relationships/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: relationshipModal.relId })
      });
      if (res.ok) {
        useMapStore.setState(prev => ({
          relationships: (prev.relationships || []).filter(r => r && r.id !== relationshipModal.relId)
        }));
        setToastMessage(`Link deleted: ${relationshipModal.sourceEntity.title} → ${relationshipModal.targetEntity.title}`);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (err) {
      console.error("Failed to delete relationship:", err);
    } finally {
      setIsSubmittingRel(false);
      setRelationshipModal(null);
      updateConnectSource(null);
      requestAnimationFrame(draw);
    }
  };

  const handleCreateRelationshipSubmit = async () => {
    if (!relationshipModal) return;
    setIsSubmittingRel(true);
    try {
      const sX = relationshipModal.sourcePos?.x;
      const sY = relationshipModal.sourcePos?.y;
      const tX = relationshipModal.targetPos?.x;
      const tY = relationshipModal.targetPos?.y;

      let posTag = '';
      if (sX !== undefined && sY !== undefined && tX !== undefined && tY !== undefined) {
        posTag = ` [Pos: ${sX.toFixed(1)},${sY.toFixed(1)}->${tX.toFixed(1)},${tY.toFixed(1)}]`;
      }

      const isSoft = modalVisibilityMode === 'soft_link';
      const isVisible = modalVisibilityMode !== 'not_visible';
      let cleanEvidence = modalEvidence.replace(/\[soft:\s*true\]/gi, '').replace(/\[style:\s*soft\]/gi, '').trim();
      if (isSoft) {
        cleanEvidence = cleanEvidence ? `${cleanEvidence} [Soft: true]` : '[Soft: true]';
      }

      const fullEvidence = cleanEvidence 
        ? `${cleanEvidence} [Style: ${modalStyle}]${posTag}`
        : `[Style: ${modalStyle}]${posTag}`;

      if (relationshipModal.isEdit && relationshipModal.relId) {
        // EDIT EXISTING RELATIONSHIP
        const res = await fetch('/api/relationships/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: relationshipModal.relId,
            type: modalType,
            evidence: fullEvidence,
            visible: isVisible
          })
        });

        if (res.ok) {
          useMapStore.setState(prev => ({
            relationships: (prev.relationships || []).map(r => 
              r && r.id === relationshipModal.relId 
                ? { ...r, type: modalType, evidence: fullEvidence, visible: isVisible }
                : r
            )
          }));
          setToastMessage(`Link updated: ${relationshipModal.sourceEntity.title} → ${relationshipModal.targetEntity.title}`);
          setTimeout(() => setToastMessage(null), 4000);
        }
      } else {
        // CREATE NEW RELATIONSHIP
        const res = await fetch('/api/relationships/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: relationshipModal.sourceEntity.id,
            target: relationshipModal.targetEntity.id,
            type: modalType,
            evidence: fullEvidence,
            weight: 2,
            visible: isVisible
          })
        });

        if (res.ok) {
          const data = await res.json();
          const newRel = data.relationship || {
            id: data.id || `manual-${Date.now()}`,
            source: relationshipModal.sourceEntity.id,
            target: relationshipModal.targetEntity.id,
            type: modalType,
            evidence: fullEvidence,
            weight: 2,
            visible: isVisible
          };
          useMapStore.setState(prev => ({
            relationships: [
              ...(prev.relationships || []).filter(r => r && !(
                (r.source === relationshipModal.sourceEntity.id && r.target === relationshipModal.targetEntity.id) ||
                (r.source === relationshipModal.targetEntity.id && r.target === relationshipModal.sourceEntity.id)
              ) && r.id !== newRel.id),
              newRel
            ]
          }));
          setToastMessage(`Link created: ${relationshipModal.sourceEntity.title} → ${relationshipModal.targetEntity.title}`);
          setTimeout(() => setToastMessage(null), 4000);
        }
      }
    } catch (err) {
      console.error('Failed to submit relationship:', err);
    } finally {
      setIsSubmittingRel(false);
      setRelationshipModal(null);
      updateConnectSource(null);
      requestAnimationFrame(draw);
    }
  };

  // Draw loop
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const { width, height } = dimsRef.current;
    const t = transformRef.current;
    const drawnSubClusterBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    subClusterLabelMetricsRef.current = [];
    subClusterConnectionDotsRef.current = [];
    softLinkBadgeHitsRef.current = [];
    
    // Get fresh state from store to avoid stale closures
    const state = useMapStore.getState();
    const { 
      entities: rawEntities, relationships, clusters, selectedEntityId, hoveredEntityId, 
      searchQuery, stageFilters, minRelevance, selectedDomains, selectedTypes, selectedTags, excludedSubTags, viewMode,
      subClusters, isConnectToolActive
    } = state;
    
    // Determine active entities and links based on the viewMode
    let activeEntities: any[] = [];
    let activeLinks: any[] = [];

    if (viewMode === 'graph' && simNodesRef.current && simNodesRef.current.length > 0) {
        activeEntities = simNodesRef.current;
        activeLinks = (simLinksRef.current || []).filter(r => r && Boolean(r.visible) && !isSoftLink(r));
    } else {
        // Both cluster, edit, and darkforest view modes display the complete entity set on top of the continent map
        activeEntities = (rawEntities || []).filter(e => {
            if (!e) return false;
            if (searchQuery && !e.title?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            if (!matchesStageFilter(e, stageFilters)) return false;
            if (e.relevance !== undefined && e.relevance < minRelevance) return false;
            if (selectedDomains.length > 0 && !selectedDomains.includes(e.domain)) return false;
            if (!matchesTypes(e.tags, selectedTypes, excludedSubTags)) return false;
            if (!matchesTags(e.tags, selectedTags)) return false;
            return true;
        });
        activeLinks = (relationships || []).filter(r => r && Boolean(r.visible) && !isSoftLink(r));
    }
    
    activeEntitiesRef.current = activeEntities;
    
    // Support retina displays
    const dpr = window.devicePixelRatio || 1;
    
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // 1. Draw "Continents" and their visual subdivisions (sub-clusters) - rendered in cluster, edit, and darkforest modes
    if (viewMode === 'cluster' || viewMode === 'edit' || viewMode === 'darkforest') {
        subClusterOutlinesRef.current = [];
        subClusterConnectionDotsRef.current = [];

        clusters.forEach(cluster => {
            if (selectedDomains.length > 0 && !selectedDomains.includes(cluster.name)) {
                return;
            }
            const clusterEntities = activeEntities.filter(e => e.domain === cluster.name);
            const allClusterEntities = rawEntities.filter(e => e.domain === cluster.name);
            
            // Draw concentric Topographic Altitude Contour Lines (Elevation Levels +100m to +400m)
            const contourLevels = [
                { padding: 110, elev: "EL. +400M", dash: [], opacity: '30', label: true },
                { padding: 150, elev: "EL. +300M", dash: [4, 4], opacity: '22', label: false },
                { padding: 190, elev: "EL. +200M", dash: [], opacity: '16', label: true },
                { padding: 230, elev: "EL. +100M", dash: [8, 8], opacity: '10', label: false }
            ];

            // Draw faint background fill using the widest boundary (Level 4, padding 230)
            const widestVertices = getClusterVertices(allClusterEntities, cluster.x, cluster.y, 230);
            if (widestVertices.length > 0) {
                ctx.beginPath();
                ctx.moveTo(widestVertices[0][0], widestVertices[0][1]);
                for (let i = 1; i < widestVertices.length; i++) {
                    ctx.lineTo(widestVertices[i][0], widestVertices[i][1]);
                }
                ctx.closePath();
                ctx.fillStyle = `${cluster.color}03`; 
                ctx.fill();
            }

            // Render each contour ring
            contourLevels.forEach(level => {
                const vertices = getClusterVertices(allClusterEntities, cluster.x, cluster.y, level.padding);
                if (vertices.length > 0) {
                    ctx.beginPath();
                    ctx.moveTo(vertices[0][0], vertices[0][1]);
                    for (let i = 1; i < vertices.length; i++) {
                        ctx.lineTo(vertices[i][0], vertices[i][1]);
                    }
                    ctx.closePath();
                    
                    ctx.strokeStyle = `${cluster.color}${level.opacity}`;
                    ctx.lineWidth = 1 / t.k;
                    if (level.dash.length > 0) {
                        ctx.setLineDash(level.dash.map(v => v / t.k));
                    } else {
                        ctx.setLineDash([]);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]); // reset

                    // Draw subtle altitude tag near the top-most vertex of the contour path
                    if (level.label && t.k >= 0.25) {
                        ctx.save();
                        ctx.fillStyle = `${cluster.color}55`;
                        const fontSize = Math.min(Math.max(6.5 / t.k, 6.5), 13);
                        ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        let topVertex = vertices[0];
                        vertices.forEach(v => {
                            if (v[1] < topVertex[1]) topVertex = v;
                        });
                        
                        ctx.fillText(level.elev, topVertex[0], topVertex[1] - 4);
                        ctx.restore();
                    }
                }
            });

            // Group clusterEntities into subdivisions (sub-clusters) based on unfiltered list for rock-solid stability
            const maxAssignedSubIdx = allClusterEntities.reduce((max: number, de: any) => {
                return (de.sub_idx !== null && de.sub_idx !== undefined) ? Math.max(max, de.sub_idx) : max;
            }, -1);
            
            const domainSubs = subClusters.filter(s => s.domain === cluster.name);
            const maxSubClusterIdx = domainSubs.reduce((max: number, ds: any) => {
                return (ds.sub_idx !== null && ds.sub_idx !== undefined) ? Math.max(max, ds.sub_idx) : max;
            }, -1);
            
            let numSubClusters = 8;
            const maxIdx = Math.max(maxAssignedSubIdx, maxSubClusterIdx);
            if (maxIdx >= numSubClusters) {
                numSubClusters = maxIdx + 1;
            }
            
            const sortedAllEntities = [...allClusterEntities].sort((a, b) => a.id.localeCompare(b.id));
            
            const entityToSubIdx = new Map<string, number>();
            sortedAllEntities.forEach((entity, idx) => {
                const subIdx = (entity.sub_idx !== null && entity.sub_idx !== undefined)
                    ? entity.sub_idx
                    : idx % numSubClusters;
                entityToSubIdx.set(entity.id, subIdx);
            });

            const unfilteredSubdivisions: Record<number, any[]> = {};
            const activeSubdivisions: Record<number, any[]> = {};

            for (let i = 0; i < numSubClusters; i++) {
                unfilteredSubdivisions[i] = [];
                activeSubdivisions[i] = [];
            }

            sortedAllEntities.forEach(entity => {
                const subIdx = entityToSubIdx.get(entity.id);
                if (subIdx !== undefined && subIdx < numSubClusters) {
                    unfilteredSubdivisions[subIdx].push(entity);
                }
            });

            clusterEntities.forEach(entity => {
                const subIdx = entityToSubIdx.get(entity.id);
                if (subIdx !== undefined && subIdx < numSubClusters) {
                    activeSubdivisions[subIdx].push(entity);
                }
            });

            // Pass 1: Pre-calculate center coordinates for all top-level sub-clusters
            const parentCentersMap = new Map<number, { x: number; y: number }>();
            for (let subIdx = 0; subIdx < numSubClusters; subIdx++) {
                const sc = subClusters.find(s => s.domain === cluster.name && s.sub_idx === subIdx);
                const isChildSubSub = sc && sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined;
                if (isChildSubSub) continue;

                const activeSubEntities = activeSubdivisions[subIdx] || [];
                let px = cluster.x;
                let py = cluster.y;

                if (activeSubEntities.length > 0) {
                    px = d3.mean(activeSubEntities, e => e.x) || cluster.x;
                    py = d3.mean(activeSubEntities, e => e.y) || cluster.y;
                } else if (sc && sc.x !== undefined && sc.x !== null && sc.y !== undefined && sc.y !== null) {
                    px = sc.x;
                    py = sc.y;
                } else {
                    const topLevelSubs = subClusters.filter(s => s.domain === cluster.name && (s.parent_sub_idx === null || s.parent_sub_idx === undefined));
                    const idxInTop = topLevelSubs.findIndex(s => s.sub_idx === subIdx);
                    const totalTop = Math.max(topLevelSubs.length, 8);
                    const angle = (Math.max(0, idxInTop) / totalTop) * Math.PI * 2;
                    px = cluster.x + Math.cos(angle) * 120;
                    py = cluster.y + Math.sin(angle) * 120;
                }
                parentCentersMap.set(subIdx, { x: px, y: py });
            }

            // Pass 2: Pre-calculate center coordinates for child sub-sub-clusters
            const subClusterCentersMap = new Map<number, { x: number; y: number }>();
            for (let subIdx = 0; subIdx < numSubClusters; subIdx++) {
                const sc = subClusters.find(s => s.domain === cluster.name && s.sub_idx === subIdx);
                const isChildSubSub = sc && sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined;
                const activeSubEntities = activeSubdivisions[subIdx] || [];

                if (!isChildSubSub) {
                    const pPos = parentCentersMap.get(subIdx) || { x: cluster.x, y: cluster.y };
                    subClusterCentersMap.set(subIdx, pPos);
                } else {
                    let cx = cluster.x;
                    let cy = cluster.y;

                    if (activeSubEntities.length > 0) {
                        cx = d3.mean(activeSubEntities, e => e.x) || cluster.x;
                        cy = d3.mean(activeSubEntities, e => e.y) || cluster.y;
                    } else if (sc && sc.x !== undefined && sc.x !== null && sc.y !== undefined && sc.y !== null) {
                        cx = sc.x;
                        cy = sc.y;
                    } else {
                        // Position inside parent sub-cluster!
                        const pPos = parentCentersMap.get(sc.parent_sub_idx!) || { x: cluster.x, y: cluster.y };
                        const siblingChildren = subClusters.filter(s => s.domain === cluster.name && s.parent_sub_idx === sc.parent_sub_idx);
                        const childIdx = siblingChildren.findIndex(s => s.sub_idx === subIdx);
                        const totalSiblings = Math.max(siblingChildren.length, 1);
                        const angle = (Math.max(0, childIdx) / totalSiblings) * Math.PI * 2;
                        const rOffset = 22; // 22px inside parent
                        cx = pPos.x + Math.cos(angle) * rOffset;
                        cy = pPos.y + Math.sin(angle) * rOffset;
                    }
                    subClusterCentersMap.set(subIdx, { x: cx, y: cy });
                }
            }

            // Pass 3: Draw each subdivision
            for (let subIdx = 0; subIdx < numSubClusters; subIdx++) {
                const activeSubEntities = activeSubdivisions[subIdx] || [];
                const sc = subClusters.find(s => s.domain === cluster.name && s.sub_idx === subIdx);
                const isChildSubSub = sc && sc.parent_sub_idx !== null && sc.parent_sub_idx !== undefined;

                const childSubs = subClusters.filter(s => s.domain === cluster.name && s.parent_sub_idx === subIdx);
                const activeChildSubs = childSubs.filter(c => (activeSubdivisions[c.sub_idx] || []).length > 0);
                const hasChildEntities = activeChildSubs.length > 0;
                const hasDirectEntities = activeSubEntities.length > 0;

                // Do NOT render empty sub-clusters on the map
                if (!hasDirectEntities && !hasChildEntities) {
                    continue;
                }

                const centerPos = subClusterCentersMap.get(subIdx) || { x: cluster.x, y: cluster.y };
                const centerX = centerPos.x;
                const centerY = centerPos.y;

                // For top-level parent sub-clusters, gather child sub-sub-clusters' centers so parent boundary wraps them
                let extraChildPoints: [number, number][] | undefined = undefined;
                if (!isChildSubSub && activeChildSubs.length > 0) {
                    extraChildPoints = [];
                    activeChildSubs.forEach(c => {
                        const cPos = subClusterCentersMap.get(c.sub_idx);
                        if (cPos) {
                            extraChildPoints!.push([cPos.x, cPos.y]);
                        }
                    });
                }

                // Dynamic padding: sub-sub-clusters start small (14px) and grow with node count
                const dynamicPadding = isChildSubSub
                    ? (activeSubEntities.length === 0 ? 14 : Math.min(18 + activeSubEntities.length * 4, 42))
                    : (activeSubEntities.length === 0 ? 25 : Math.min(28 + activeSubEntities.length * 5, 65));

                const subVertices = getClusterVertices(activeSubEntities, centerX, centerY, dynamicPadding, extraChildPoints);

                // Store outline for dynamic cursor hover snapping
                if (subVertices.length > 0) {
                    subClusterOutlinesRef.current.push({
                        domain: cluster.name,
                        subIdx,
                        title: sc ? sc.title : `SEC-0${subIdx + 1}`,
                        color: cluster.color,
                        vertices: subVertices,
                        centerX,
                        centerY,
                        isChildSubSub: Boolean(isChildSubSub)
                    });
                }
                
                if (subVertices.length > 0) {
                    ctx.beginPath();
                    ctx.moveTo(subVertices[0][0], subVertices[0][1]);
                    for (let i = 1; i < subVertices.length; i++) {
                        ctx.lineTo(subVertices[i][0], subVertices[i][1]);
                    }
                    ctx.closePath();
                    
                    if (isChildSubSub) {
                        ctx.fillStyle = `${cluster.color}1c`; 
                        ctx.fill();
                        ctx.strokeStyle = `${cluster.color}65`;
                        ctx.lineWidth = 1 / t.k;
                        ctx.setLineDash([2 / t.k, 2 / t.k]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    } else {
                        ctx.fillStyle = `${cluster.color}0e`; 
                        ctx.fill();
                        ctx.strokeStyle = `${cluster.color}35`;
                        ctx.lineWidth = 1 / t.k;
                        ctx.setLineDash([4 / t.k, 4 / t.k]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }

                // Subdivision label
                if (t.k >= 0.15 && t.k <= 2.2) {
                    const rawTitle = sc ? sc.title.toUpperCase() : `SEC-0${subIdx + 1}`;
                    const labelText = isChildSubSub ? `↳ ${rawTitle}` : rawTitle;
                    
                    const nameSum = cluster.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) + subIdx;
                    const angles = [-15, -10, -5, 0, 5, 10, 15];
                    const angleDeg = (sc && sc.angle !== undefined && sc.angle !== null) ? sc.angle : angles[nameSum % angles.length];
                    const angleRad = (angleDeg * Math.PI) / 180;

                    const baseFontSize = Math.min(Math.max(11 / t.k, 8), 18);
                    const drawFontSize = isChildSubSub ? baseFontSize * 0.82 : baseFontSize;
                    
                    const bestPos = findBestLabelPosition(
                        activeSubEntities,
                        centerX,
                        centerY,
                        activeEntities,
                        labelText,
                        drawFontSize,
                        t,
                        drawnSubClusterBoxes
                    );
                    
                    const labelX = (sc && sc.x !== undefined && sc.x !== null) ? sc.x : bestPos.x;
                    const labelY = (sc && sc.y !== undefined && sc.y !== null) ? sc.y : bestPos.y;
                    
                    // Keep track of this drawn box
                    drawnSubClusterBoxes.push({
                        x1: labelX - bestPos.width / 2,
                        x2: labelX + bestPos.width / 2,
                        y1: labelY - bestPos.height / 2,
                        y2: labelY + bestPos.height / 2
                    });

                    subClusterLabelMetricsRef.current.push({
                        domain: cluster.name,
                        subIdx,
                        text: labelText,
                        x: labelX,
                        y: labelY,
                        width: bestPos.width,
                        height: bestPos.height,
                        angle: angleDeg,
                        color: cluster.color
                    });

                    const isHovered = hoveredSubClusterRef.current && 
                                      hoveredSubClusterRef.current.domain === cluster.name && 
                                      hoveredSubClusterRef.current.subIdx === subIdx;
                    
                    const isSelected = selectedSubClusterRef.current && 
                                       selectedSubClusterRef.current.domain === cluster.name && 
                                       selectedSubClusterRef.current.subIdx === subIdx;

                    ctx.save();
                    // Position above the sub-cluster boundary
                    ctx.translate(labelX, labelY);
                    ctx.rotate(angleRad);

                    // Draw selection highlight and rotation handle if hovered or selected
                    if (isHovered || isSelected) {
                        ctx.beginPath();
                        ctx.rect(-bestPos.width / 2 - 6, -bestPos.height / 2 - 4, bestPos.width + 12, bestPos.height + 8);
                        ctx.strokeStyle = isSelected ? `${cluster.color}99` : `${cluster.color}55`;
                        ctx.lineWidth = 1 / t.k;
                        ctx.setLineDash([3 / t.k, 3 / t.k]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        
                        // Draw line and rotate handle circle
                        ctx.beginPath();
                        ctx.moveTo(0, -bestPos.height / 2 - 4);
                        ctx.lineTo(0, -bestPos.height / 2 - 18);
                        ctx.strokeStyle = `${cluster.color}77`;
                        ctx.lineWidth = 1 / t.k;
                        ctx.stroke();
                        
                        ctx.beginPath();
                        ctx.arc(0, -bestPos.height / 2 - 18, 5 / t.k, 0, 2 * Math.PI);
                        ctx.fillStyle = cluster.color;
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 1 / t.k;
                        ctx.fill();
                        ctx.stroke();
                    }

                    if (isChildSubSub) {
                        ctx.fillStyle = `${cluster.color}88`;
                        ctx.font = `600 ${drawFontSize}px "Space Grotesk", sans-serif`;
                    } else {
                        ctx.fillStyle = `${cluster.color}cb`;
                        ctx.font = `700 ${drawFontSize}px "Space Grotesk", sans-serif`;
                    }
                    ctx.textAlign = 'center';
                    ctx.fillText(labelText, 0, 0);

                    // Minor identifier underneath (only for top-level sub-clusters)
                    if (!isChildSubSub) {
                        const subLabelText = `SEC-0${subIdx + 1}`;
                        ctx.fillStyle = `${cluster.color}55`;
                        ctx.font = `500 ${drawFontSize * 0.7}px "JetBrains Mono", monospace`;
                        ctx.fillText(subLabelText, 0, drawFontSize + 2);
                    }
                    ctx.restore();
                }
            }
            
            // Draw continent label with custom position, angle, and drag/rotation interaction support
            const outerVertices = getClusterVertices(allClusterEntities, cluster.x, cluster.y, 230);
            let topX = cluster.x;
            let topY = cluster.y - 280;
            if (outerVertices.length > 0) {
                let minYVertex = outerVertices[0];
                outerVertices.forEach(v => {
                    if (v[1] < minYVertex[1]) {
                        minYVertex = v;
                    }
                });
                topX = minYVertex[0];
                topY = minYVertex[1] - 30; // 30px above the outermost contour boundary
            }

            const scContinent = subClusters.find(s => s.domain === cluster.name && s.sub_idx === -1);
            const hasCustomPos = scContinent && scContinent.x !== undefined && scContinent.x !== null && scContinent.y !== undefined && scContinent.y !== null;
            const continentX = hasCustomPos ? scContinent.x! : (t.k < 0.25 ? cluster.x : topX);
            const continentY = hasCustomPos ? scContinent.y! : (t.k < 0.25 ? cluster.y - 150 : topY);
            const continentAngle = (scContinent && scContinent.angle !== undefined && scContinent.angle !== null) ? scContinent.angle : 0;

            const labelText = cluster.name.toUpperCase();
            const fontSize = t.k < 0.25 ? 120 : 36;
            const labelWidth = labelText.length * fontSize * 0.55;
            const labelHeight = fontSize;

            // Push continent label metrics to subClusterLabelMetricsRef so that hover/drag/rotate works seamlessly!
            subClusterLabelMetricsRef.current.push({
                domain: cluster.name,
                subIdx: -1,
                text: labelText,
                x: continentX,
                y: continentY,
                width: labelWidth,
                height: labelHeight,
                angle: continentAngle,
                color: cluster.color
            });

            const isContinentHovered = hoveredSubClusterRef.current && 
                              hoveredSubClusterRef.current.domain === cluster.name && 
                              hoveredSubClusterRef.current.subIdx === -1;
            
            const isContinentSelected = selectedSubClusterRef.current && 
                               selectedSubClusterRef.current.domain === cluster.name && 
                               selectedSubClusterRef.current.subIdx === -1;

            ctx.save();
            ctx.translate(continentX, continentY);
            ctx.rotate((continentAngle * Math.PI) / 180);

            // Draw selection highlight and rotation handle if hovered or selected
            if (isContinentHovered || isContinentSelected) {
                ctx.beginPath();
                ctx.rect(-labelWidth / 2 - 10, -labelHeight / 2 - 8, labelWidth + 20, labelHeight + 16);
                ctx.strokeStyle = isContinentSelected ? `${cluster.color}aa` : `${cluster.color}66`;
                ctx.lineWidth = (t.k < 0.25 ? 4 : 1.5) / t.k;
                ctx.setLineDash([6 / t.k, 6 / t.k]);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Draw line and rotate handle circle
                ctx.beginPath();
                ctx.moveTo(0, -labelHeight / 2 - 8);
                ctx.lineTo(0, -labelHeight / 2 - 30);
                ctx.strokeStyle = `${cluster.color}88`;
                ctx.lineWidth = (t.k < 0.25 ? 4 : 1.5) / t.k;
                ctx.stroke();
                
                ctx.beginPath();
                ctx.arc(0, -labelHeight / 2 - 30, (t.k < 0.25 ? 12 : 6) / t.k, 0, 2 * Math.PI);
                ctx.fillStyle = cluster.color;
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = (t.k < 0.25 ? 4 : 1.5) / t.k;
                ctx.fill();
                ctx.stroke();
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (t.k < 0.25) {
                ctx.fillStyle = `${cluster.color}70`;
                ctx.font = 'bold 120px "Space Grotesk", sans-serif';
                ctx.fillText(labelText, 0, 0);
            } else {
                ctx.fillStyle = `${cluster.color}44`; // slightly translucent and more subtle
                ctx.font = 'bold 36px "Space Grotesk", sans-serif';
                ctx.fillText(labelText, 0, 0);
            }
            ctx.restore();
        });
    }

    // Helper to resolve coordinates for nodes or sub-clusters
    const getItemCoords = (itemId: string): { x: number; y: number } | null => {
      if (!itemId) return null;
      const strId = typeof itemId === 'object' ? (itemId as any).id : itemId;
      if (typeof strId === 'string' && strId.startsWith('subcluster:')) {
        const parts = strId.split(':');
        const domain = parts[1];
        const subIdx = Number(parts[2]);

        // Prioritize active connect source
        if (connectSourceRef.current && connectSourceRef.current.type === 'subcluster' && 
            connectSourceRef.current.domain === domain && connectSourceRef.current.subIdx === subIdx) {
          return { x: connectSourceRef.current.x, y: connectSourceRef.current.y };
        }
        
        // Prioritize saved connection dot location on outline
        const dot = subClusterConnectionDotsRef.current.find(d => d.domain === domain && d.subIdx === subIdx);
        if (dot) return { x: dot.x, y: dot.y };

        // Fallback to outline center
        const outline = subClusterOutlinesRef.current.find(o => o.domain === domain && o.subIdx === subIdx);
        if (outline) return { x: outline.centerX, y: outline.centerY };

        // Fallback to title label
        const label = subClusterLabelMetricsRef.current.find(l => l.domain === domain && l.subIdx === subIdx);
        if (label) return { x: label.x, y: label.y };

        const sc = subClusters.find(s => s.domain === domain && s.sub_idx === subIdx);
        if (sc && sc.x !== undefined && sc.y !== undefined) return { x: sc.x, y: sc.y };
        return null;
      }
      const ent = activeEntities.find(e => e.id === strId);
      if (ent) return { x: ent.x, y: ent.y };
      return null;
    };

    // 2. Draw Roads (Edges)
    renderedLinksRef.current = [];
    ctx.lineWidth = 1 / t.k; // Constant physical width
    activeLinks.forEach(rel => {
        const srcId = typeof rel.source === 'object' ? rel.source.id : rel.source;
        const tgtId = typeof rel.target === 'object' ? rel.target.id : rel.target;

        // Filter out relationship lines when domains are selected if either endpoint is not in selected domains
        const getItemDomain = (itemId: any): string | null => {
            if (!itemId) return null;
            const strId = typeof itemId === 'object' ? itemId.id : itemId;
            if (typeof strId === 'string' && strId.startsWith('subcluster:')) {
                const parts = strId.split(':');
                return parts[1] || null;
            }
            const ent = rawEntities.find(e => e.id === strId);
            return ent ? ent.domain : null;
        };

        if (selectedDomains.length > 0) {
            const srcDomain = getItemDomain(srcId);
            const tgtDomain = getItemDomain(tgtId);
            if (!srcDomain || !tgtDomain || !selectedDomains.includes(srcDomain) || !selectedDomains.includes(tgtDomain)) {
                return;
            }
        }

        const isSubClusterLink = (typeof srcId === 'string' && srcId.startsWith('subcluster:')) || (typeof tgtId === 'string' && tgtId.startsWith('subcluster:'));

        // Check if user toggled off relationship lines
        if (!showRelationshipLinesRef.current && !isSubClusterLink) {
            return;
        }

        // Lines connecting nodes only appear at Regional (t.k >= 0.3) and Local (t.k >= 0.8) levels.
        // Sub-cluster lines remain visible at all zoom levels.
        if (!isSubClusterLink && t.k < 0.3) {
            return;
        }

        const parsed = parseRelEvidenceAndPos(rel);

        // Resolve source position
        let source: { x: number; y: number } | null = null;
        if (typeof srcId === 'string' && srcId.startsWith('subcluster:')) {
            const parts = srcId.split(':');
            const domain = parts[1];
            const subIdx = Number(parts[2]);
            const outline = subClusterOutlinesRef.current.find(o => o.domain === domain && o.subIdx === subIdx);
            
            const tempTarget = getItemCoords(tgtId);

            if (outline && outline.vertices && outline.vertices.length >= 3 && tempTarget) {
                const { point } = getClosestPointOnPolygon([tempTarget.x, tempTarget.y], outline.vertices);
                source = { x: point[0], y: point[1] };
            } else if (outline) {
                source = { x: outline.centerX, y: outline.centerY };
            } else {
                source = getItemCoords(srcId);
            }
        } else {
            source = getItemCoords(srcId);
        }

        // Resolve target position
        let target: { x: number; y: number } | null = null;
        if (typeof tgtId === 'string' && tgtId.startsWith('subcluster:')) {
            const parts = tgtId.split(':');
            const domain = parts[1];
            const subIdx = Number(parts[2]);
            const outline = subClusterOutlinesRef.current.find(o => o.domain === domain && o.subIdx === subIdx);
            const sourceRef = source || getItemCoords(srcId);
            if (outline && outline.vertices && outline.vertices.length >= 3 && sourceRef) {
                const { point } = getClosestPointOnPolygon([sourceRef.x, sourceRef.y], outline.vertices);
                target = { x: point[0], y: point[1] };
            } else if (outline) {
                target = { x: outline.centerX, y: outline.centerY };
            } else {
                target = getItemCoords(tgtId);
            }
        } else {
            target = getItemCoords(tgtId);
        }

        // Refine source position for subclusters using exact target position on border outline
        if (typeof srcId === 'string' && srcId.startsWith('subcluster:') && target) {
            const parts = srcId.split(':');
            const domain = parts[1];
            const subIdx = Number(parts[2]);
            const outline = subClusterOutlinesRef.current.find(o => o.domain === domain && o.subIdx === subIdx);
            if (outline && outline.vertices && outline.vertices.length >= 3) {
                const { point } = getClosestPointOnPolygon([target.x, target.y], outline.vertices);
                source = { x: point[0], y: point[1] };
            }
        }

        if (!source || !target) return;

        // Store rendered line for mouse interaction
        renderedLinksRef.current.push({
            rel,
            x1: source.x,
            y1: source.y,
            x2: target.x,
            y2: target.y
        });

        // Semantic zoom for edges (show all explicitly marked visible edges)
        if (viewMode !== 'edit' && !rel.visible) {
            if (t.k < 0.3 && rel.weight < 3) return;
            if (t.k < 0.8 && rel.weight < 2) return;
        }

        const isHoveredLine = hoveredRelationshipRef.current && hoveredRelationshipRef.current.id === rel.id;
        const isHighlighted = isHoveredLine || selectedEntityId === srcId || selectedEntityId === tgtId || hoveredEntityId === srcId || hoveredEntityId === tgtId;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const len = Math.hypot(dx, dy);

        let tipX = target.x;
        let tipY = target.y;

        if (len > 0) {
            const ux = dx / len;
            const uy = dy / len;
            
            let targetRadius = 4;
            const tgtEntity = activeEntities.find(e => e.id === tgtId);
            if (tgtEntity) {
                targetRadius = getEntityRadius(tgtEntity);
            }
            
            const offset = Math.min(targetRadius + 2 / t.k, len);
            tipX = target.x - ux * offset;
            tipY = target.y - uy * offset;
        }

        const srcEntity = activeEntities.find(e => e.id === srcId);
        const tgtEntity = activeEntities.find(e => e.id === tgtId);
        const srcCluster = srcEntity ? clusters.find(c => c.name === srcEntity.domain) : null;
        const tgtCluster = tgtEntity ? clusters.find(c => c.name === tgtEntity.domain) : null;
        const domainColor = (srcCluster && srcCluster.color) || (tgtCluster && tgtCluster.color) || '#94a3b8';
        const grayedColor = d3.interpolateRgb(domainColor, '#475569')(0.70);

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(tipX, tipY);

        if (parsed.style === 'dotted') {
            ctx.setLineDash([5 / t.k, 5 / t.k]);
        } else {
            ctx.setLineDash([]);
        }

        let lineStrokeColor = grayedColor;
        if (isHoveredLine) {
            lineStrokeColor = '#818cf8'; // Bright indigo highlight for hovered line
            ctx.lineWidth = 4 / t.k;
        } else if (isHighlighted) {
            lineStrokeColor = '#ffffff'; // crisp white highlight
            ctx.lineWidth = 3.5 / t.k;
        } else {
            lineStrokeColor = grayedColor; // 70% grayed out domain color line
            ctx.lineWidth = Math.max((rel.weight || 2) / t.k, 1.8 / t.k);
        }
        ctx.strokeStyle = lineStrokeColor;
        ctx.stroke();
        ctx.setLineDash([]);

        // Always draw Arrowhead at the end (from -> to) for non-dotted lines
        if (len > 0 && parsed.style !== 'dotted') {
            const angle = Math.atan2(dy, dx);
            const arrowLength = Math.max(7 / t.k, 4 / t.k);
            const arrowAngle = Math.PI / 6;

            const w1x = tipX - arrowLength * Math.cos(angle - arrowAngle);
            const w1y = tipY - arrowLength * Math.sin(angle - arrowAngle);
            const w2x = tipX - arrowLength * Math.cos(angle + arrowAngle);
            const w2y = tipY - arrowLength * Math.sin(angle + arrowAngle);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(w1x, w1y);
            ctx.lineTo(w2x, w2y);
            ctx.closePath();
            ctx.fillStyle = isHoveredLine ? '#818cf8' : isHighlighted ? '#ffffff' : grayedColor;
            ctx.setLineDash([]);
            ctx.fill();
            ctx.restore();
        }

        // Render relationship type label on top of line if clicked and context is empty
        if (activeLineLabelRelIdRef.current === rel.id) {
            ctx.save();
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            const labelText = (rel.type || 'references').replace(/_/g, ' ').toUpperCase();

            const fontSize = Math.min(12 / t.k, Math.max(8 / t.k, 10 / t.k));
            ctx.font = `bold ${fontSize}px font-mono, sans-serif`;
            const textWidth = ctx.measureText(labelText).width;
            const paddingX = 8 / t.k;
            const paddingY = 4 / t.k;
            const boxWidth = textWidth + paddingX * 2;
            const boxHeight = fontSize + paddingY * 2;

            const rx = midX - boxWidth / 2;
            const ry = midY - boxHeight / 2;
            const cornerRadius = 4 / t.k;

            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(rx, ry, boxWidth, boxHeight, cornerRadius);
            } else {
                ctx.rect(rx, ry, boxWidth, boxHeight);
            }
            ctx.fillStyle = '#0f121d';
            ctx.fill();

            ctx.fillStyle = '#e0e7ff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, midX, midY);
            ctx.restore();
        }
    });

    // 2b. Draw live connection preview line when Connect Tool is active in Edit Mode
    if (isConnectToolActive && connectSource && mouseWorldPosRef.current && viewMode === 'edit') {
        const mouseX = mouseWorldPosRef.current.x;
        const mouseY = mouseWorldPosRef.current.y;
        const dx = mouseX - connectSource.x;
        const dy = mouseY - connectSource.y;
        const len = Math.hypot(dx, dy);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(connectSource.x, connectSource.y);
        ctx.lineTo(mouseX, mouseY);
        ctx.strokeStyle = '#818cf8'; // Indigo 400
        ctx.lineWidth = 2.5 / t.k;
        if (connectLineStyle === 'dotted') {
            ctx.setLineDash([6 / t.k, 6 / t.k]);
        } else {
            ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (len > 0 && connectLineStyle !== 'dotted') {
            const angle = Math.atan2(dy, dx);
            const arrowLength = Math.max(8 / t.k, 4 / t.k);
            const arrowAngle = Math.PI / 6;

            const w1x = mouseX - arrowLength * Math.cos(angle - arrowAngle);
            const w1y = mouseY - arrowLength * Math.sin(angle - arrowAngle);
            const w2x = mouseX - arrowLength * Math.cos(angle + arrowAngle);
            const w2y = mouseY - arrowLength * Math.sin(angle + arrowAngle);

            ctx.beginPath();
            ctx.moveTo(mouseX, mouseY);
            ctx.lineTo(w1x, w1y);
            ctx.lineTo(w2x, w2y);
            ctx.closePath();
            ctx.fillStyle = '#818cf8';
            ctx.fill();
        }

        // Pulsing cursor halo
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 6 / t.k, 0, 2 * Math.PI);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / t.k;
        ctx.stroke();
        ctx.restore();
    }

    // 3. Draw Nodes (All nodes visible at all times, even at world level)
    activeEntities.forEach(entity => {
        const isSelected = selectedEntityId === entity.id;
        const isHovered = hoveredEntityId === entity.id;
        const isMultiSelected = selectedEntityIdsRef.current.has(entity.id);
        const isNewNote = entity.is_new === 1 || entity.is_new === true || (entity.tags || []).some((t: string) => t === '🕳' || t === '#🕳') || entity.stage === '🕳';
        const isDarkForest = viewMode === 'darkforest';
        const cluster = clusters.find(c => c.name === entity.domain);
        let color = cluster ? cluster.color : '#cbd5e1';
        if (isDarkForest && isNewNote) {
            color = '#10b981'; // Vivid emerald green fill for raw notes in Dark Forest mode
        }
        // Completely grey color for source entities
        if (isSourceEntity(entity) && !isSelected) {
            color = '#64748b';
        }
        
        // Show node size by node density (length of the note)
        const radius = getEntityRadius(entity);
        
        // Draw multi-selection ring
        if (isMultiSelected) {
            ctx.beginPath();
            ctx.arc(entity.x, entity.y, radius + 4 / t.k, 0, 2 * Math.PI);
            ctx.strokeStyle = '#6366f1'; // Beautiful indigo selection outline
            ctx.lineWidth = 2.5 / t.k;
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(entity.x, entity.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? '#ffffff' : color;
        ctx.fill();
        
        if (isNewNote) {
            ctx.beginPath();
            ctx.arc(entity.x, entity.y, radius + 3 / t.k, 0, 2 * Math.PI);
            ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : '#34d399';
            ctx.lineWidth = 2 / t.k;
            ctx.stroke();
        } else if (isHovered || isSelected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 / t.k;
            ctx.stroke();
        }

        // Draw Soft Link Count Badge on bottom-right of node circle (simply the number, no circle background, indigo color)
        const nodeSoftLinks = (relationships || []).filter(r => r && isSoftLink(r) && (r.source === entity.id || r.target === entity.id));
        if (nodeSoftLinks.length > 0 && t.k >= 0.35) {
            // Screen font size: slightly larger at local level (t.k >= 0.8), capped so it stays small beside the node
            const screenFontSize = t.k >= 0.8 
                ? Math.min(13.5, 10.5 + (t.k - 0.8) * 2.5) 
                : Math.min(10, Math.max(7.5, 9 * Math.min(1, t.k)));
            const fontWorldSize = screenFontSize / t.k;

            const zoomDelta = Math.max(0, t.k - 0.8);
            const extraX = 4 + zoomDelta * 3.5;
            const extraY = 2 + zoomDelta * 3.0;

            const offsetX = radius * 0.85 + (extraX / t.k);
            const offsetY = radius * 0.55 + (extraY / t.k);
            const badgeX = entity.x + offsetX;
            const badgeY = entity.y + offsetY;
            const hitRadiusWorld = Math.max((screenFontSize * 0.75) / t.k, 4.5 / t.k);

            softLinkBadgeHitsRef.current.push({
                entity,
                badgeX,
                badgeY,
                badgeRadius: hitRadiusWorld,
                softLinks: nodeSoftLinks
            });

            ctx.save();
            ctx.shadowColor = 'rgba(10, 12, 16, 0.95)';
            ctx.shadowBlur = 3 / t.k;
            ctx.font = `bold ${fontWorldSize}px font-mono, sans-serif`;
            ctx.fillStyle = '#818cf8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(nodeSoftLinks.length), badgeX, badgeY);
            ctx.restore();
        }

        // Draw Relevance Score Badge on bottom-left of node circle (local level only, t.k >= 0.8, relevance > 0)
        if (entity.relevance !== undefined && entity.relevance !== null && entity.relevance > 0 && t.k >= 0.8) {
            const screenFontSize = Math.min(13.5, 10.5 + (t.k - 0.8) * 2.5);
            const relScreenFontSize = screenFontSize * 0.7;
            const relFontWorldSize = relScreenFontSize / t.k;

            const zoomDelta = Math.max(0, t.k - 0.8);
            const extraX = 4 + zoomDelta * 3.5;
            const extraY = 2 + zoomDelta * 3.0;

            const relOffsetX = -(radius * 0.85 + (extraX / t.k));
            const relOffsetY = radius * 0.55 + (extraY / t.k);
            const relBadgeX = entity.x + relOffsetX;
            const relBadgeY = entity.y + relOffsetY;

            ctx.save();
            ctx.shadowColor = 'rgba(10, 12, 16, 0.8)';
            ctx.shadowBlur = 2 / t.k;
            ctx.font = `bold ${relFontWorldSize}px font-mono, sans-serif`;
            ctx.fillStyle = 'rgba(203, 213, 225, 0.6)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(entity.relevance), relBadgeX, relBadgeY);
            ctx.restore();
        }
    });

    // 4. Draw Labels with overlap/spacing collision prevention
    const sortedForLabels = [...activeEntities].sort((a, b) => {
        const aSelected = selectedEntityId === a.id;
        const bSelected = selectedEntityId === b.id;
        if (aSelected !== bSelected) return aSelected ? -1 : 1;

        const aHovered = hoveredEntityId === a.id;
        const bHovered = hoveredEntityId === b.id;
        if (aHovered !== bHovered) return aHovered ? -1 : 1;

        const scaleOrder: Record<string, number> = { landmark: 4, city: 3, neighborhood: 2, street: 1 };
        const aScale = scaleOrder[a.scale || 'street'] || 1;
        const bScale = scaleOrder[b.scale || 'street'] || 1;
        if (aScale !== bScale) return bScale - aScale;

        return (b.relevance ?? 0) - (a.relevance ?? 0);
    });

    const drawnLabelBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    sortedForLabels.forEach(entity => {
        const isSelected = selectedEntityId === entity.id;
        const isHovered = hoveredEntityId === entity.id;

        // Determine if label should be shown based on zoom level (t.k)
        let showLabel = false;
        if (viewMode === 'darkforest') {
            showLabel = true; // Always show titles for raw notes in Dark Forest mode
        } else if (t.k >= 0.8) {
            showLabel = true;
        } else if (t.k >= 0.3) {
            if (entity.scale === 'landmark' || entity.scale === 'city' || (entity.relevance !== undefined && entity.relevance >= 80)) {
                showLabel = true;
            }
        } else {
            if (entity.scale === 'landmark' && t.k >= 0.05) {
                showLabel = true;
            }
        }
        
        if (isSelected || isHovered) showLabel = true;

        if (showLabel) {
            const radius = getEntityRadius(entity);

            const fontSize = entity.scale === 'landmark' ? 14 / t.k : 10.5 / t.k;
            const cappedFontSize = Math.min(Math.max(fontSize, 2), 40); // Cap font size in world units
            const screenFontSize = cappedFontSize * t.k;

            // Calculate screen coordinates to check overlap
            const screenX = entity.x * t.k + t.x;
            const screenY = entity.y * t.k + t.y;

            // Approximate label width and height on screen
            const screenLabelWidth = entity.title.length * screenFontSize * 0.55 + 16; // 16px horizontal spacing
            const screenLabelHeight = screenFontSize + 8; // 8px vertical spacing
            const x1 = screenX - screenLabelWidth / 2;
            const x2 = screenX + screenLabelWidth / 2;
            const y1 = screenY + (radius * t.k) + 4;
            const y2 = y1 + screenLabelHeight;

            let overlaps = false;
            if (!isSelected && !isHovered) {
                for (const box of drawnLabelBoxes) {
                    if (x1 < box.x2 && x2 > box.x1 && y1 < box.y2 && y2 > box.y1) {
                        overlaps = true;
                        break;
                    }
                }
            }

            if (!overlaps) {
                drawnLabelBoxes.push({ x1, y1, x2, y2 });

                if (isSelected || isHovered) {
                    ctx.fillStyle = '#ffffff';
                    ctx.font = `600 ${cappedFontSize}px "Space Grotesk", "Inter", sans-serif`;
                } else if (viewMode === 'darkforest') {
                    ctx.fillStyle = '#a7f3d0';
                    ctx.font = `600 ${cappedFontSize}px "Space Grotesk", "Inter", sans-serif`;
                } else if (isSourceEntity(entity)) {
                    ctx.fillStyle = '#94a3b8'; // Slightly faded text for sources
                    ctx.font = `500 ${cappedFontSize}px "Space Grotesk", "Inter", sans-serif`;
                } else {
                    ctx.fillStyle = '#cbd5e1';
                    ctx.font = `500 ${cappedFontSize}px "Space Grotesk", "Inter", sans-serif`;
                }

                ctx.textAlign = 'center';
                ctx.fillText(entity.title, entity.x, entity.y + radius + cappedFontSize + 2 / t.k);
            }
        }
    });

    if (isSelectingBoxRef.current) {
        ctx.strokeStyle = '#6366f1'; // Indigo-500
        ctx.lineWidth = 1.5 / t.k;
        ctx.setLineDash([4 / t.k, 4 / t.k]);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.08)'; // Indigo with 8% opacity
        
        const x1 = selectionStartRef.current.x;
        const y1 = selectionStartRef.current.y;
        const x2 = selectionEndRef.current.x;
        const y2 = selectionEndRef.current.y;
        
        ctx.beginPath();
        ctx.rect(x1, y1, x2 - x1, y2 - y1);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]); // clear dash pattern
    }

    // Render sub-cluster connection dot on hovered outline when Connect Tool is active
    if (isConnectToolActive) {
        // Draw dashed guide outlines for all sub-clusters when Connect Tool is active
        subClusterOutlinesRef.current.forEach(outline => {
            const isHovered = hoveredSubClusterOutlineRef.current?.domain === outline.domain && hoveredSubClusterOutlineRef.current?.subIdx === outline.subIdx;
            if (!isHovered && outline.vertices && outline.vertices.length > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(outline.vertices[0][0], outline.vertices[0][1]);
                for (let i = 1; i < outline.vertices.length; i++) {
                    ctx.lineTo(outline.vertices[i][0], outline.vertices[i][1]);
                }
                ctx.closePath();
                ctx.strokeStyle = `${outline.color || '#a5b4fc'}88`;
                ctx.lineWidth = 1.5 / t.k;
                ctx.setLineDash([4 / t.k, 4 / t.k]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        });

        if (hoveredSubClusterOutlineRef.current) {
            const dot = hoveredSubClusterOutlineRef.current;
            ctx.save();
            
            // Highlight active outline boundary
            if (dot.vertices && dot.vertices.length > 0) {
                ctx.beginPath();
                ctx.moveTo(dot.vertices[0][0], dot.vertices[0][1]);
                for (let i = 1; i < dot.vertices.length; i++) {
                    ctx.lineTo(dot.vertices[i][0], dot.vertices[i][1]);
                }
                ctx.closePath();
                ctx.strokeStyle = '#818cf8';
                ctx.lineWidth = 2.5 / t.k;
                ctx.stroke();
            }

            // Draw connection dot at exact hovered perimeter point (constant screen size)
            ctx.beginPath();
            const dotRadius = 7.5 / t.k;
            ctx.arc(dot.x, dot.y, dotRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#818cf8';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 / t.k;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dotRadius + 4.5 / t.k, 0, 2 * Math.PI);
            ctx.strokeStyle = '#a5b4fc';
            ctx.lineWidth = 1.5 / t.k;
            ctx.setLineDash([3 / t.k, 3 / t.k]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        if (connectSource && connectSource.type === 'subcluster') {
            ctx.save();
            ctx.beginPath();
            const dotRadius = 8 / t.k;
            ctx.arc(connectSource.x, connectSource.y, dotRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#6366f1';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5 / t.k;
            ctx.stroke();
            ctx.restore();
        }
    }

    // Render active rubberband connection line
    if (connectSource && mouseWorldPosRef.current) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(connectSource.x, connectSource.y);
        ctx.lineTo(mouseWorldPosRef.current.x, mouseWorldPosRef.current.y);
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = Math.min(2.5 / t.k, 5);
        if (connectLineStyle === 'dotted') {
            ctx.setLineDash([6 / t.k, 6 / t.k]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Cursor indicator dot
        ctx.beginPath();
        ctx.arc(mouseWorldPosRef.current.x, mouseWorldPosRef.current.y, Math.min(5 / t.k, 10), 0, 2 * Math.PI);
        ctx.fillStyle = '#818cf8';
        ctx.fill();
        ctx.restore();
    }

    ctx.restore();
  };

  // Live force simulation for Relationship Graph View
  useEffect(() => {
    if (viewMode !== 'graph') {
        if (simulationRef.current) {
            simulationRef.current.stop();
            simulationRef.current = null;
        }
        return;
    }

    const state = useMapStore.getState();
    const rawEntities = state.entities;
    const rawRelationships = state.relationships;

    const filtered = rawEntities.filter(e => {
        if (searchQuery && !e.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (!matchesStageFilter(e, stageFilters)) return false;
        if (e.relevance !== undefined && e.relevance < minRelevance) return false;
        if (selectedDomains.length > 0 && !selectedDomains.includes(e.domain)) return false;
        if (!matchesTypes(e.tags, selectedTypes, excludedSubTags)) return false;
        if (!matchesTags(e.tags, selectedTags)) return false;
        return true;
    });

    const nodes = filtered.map(e => {
        const existing = simNodesRef.current.find(sn => sn.id === e.id);
        return {
            ...e,
            x: existing ? existing.x : e.x,
            y: existing ? existing.y : e.y,
            vx: existing ? existing.vx : 0,
            vy: existing ? existing.vy : 0
        };
    });

    const links = (rawRelationships || [])
        .filter((r): r is NonNullable<typeof r> => Boolean(r && r.source && r.target))
        .map(r => ({ ...r }))
        .filter(r => {
            const srcId = typeof r.source === 'object' && r.source !== null ? (r.source as any).id : r.source;
            const tgtId = typeof r.target === 'object' && r.target !== null ? (r.target as any).id : r.target;
            return Boolean(srcId && tgtId && nodes.some(n => n.id === srcId) && nodes.some(n => n.id === tgtId));
        });

    simNodesRef.current = nodes;
    simLinksRef.current = links;

    if (simulationRef.current) {
        simulationRef.current.stop();
    }

    simulationRef.current = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(150))
        .force('charge', d3.forceManyBody().strength(-240))
        .force('collide', d3.forceCollide().radius(e => getEntityRadius(e) + 16))
        .force('x', d3.forceX(0).strength(0.06))
        .force('y', d3.forceY(0).strength(0.06))
        .on('tick', () => {
            draw();
        });

    return () => {
        if (simulationRef.current) {
            simulationRef.current.stop();
        }
    };
  }, [viewMode, entities, relationships, searchQuery, stageFilters, minRelevance, selectedDomains, selectedTypes, selectedTags, excludedSubTags]);

  useEffect(() => {
    if (!isConnectToolActive) {
      hoveredSubClusterOutlineRef.current = null;
    }
    requestAnimationFrame(draw);
  }, [isConnectToolActive]);

  // Setup D3 Zoom and Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
        const { width, height } = container.getBoundingClientRect();
        dimsRef.current = { width, height };
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
        draw();
    };

    window.addEventListener('resize', resize);
    resize();

    // Initial Zoom transform to fit everything
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.01, 10])
        .filter((event) => {
            // Disable zoom panning if the user is hovering/dragging a node or sub-cluster, or if Shift is held
            const state = useMapStore.getState();
            const hoveringSubCluster = (viewMode === 'cluster' || viewMode === 'edit') && hoveredSubClusterRef.current !== null;
            const isConnActive = state.isConnectToolActive;
            const hoveringConnTarget = isConnActive && (
                state.hoveredEntityId !== null || 
                hoveredSubClusterOutlineRef.current !== null || 
                hoveredSubClusterRef.current !== null
            );
            return !state.hoveredEntityId && !isDraggingRef.current && !hoveringSubCluster && !hoveredSubClusterOutlineRef.current && !hoveringConnTarget && !isDraggingSubClusterRef.current && !isRotatingSubClusterRef.current && !event.button && !event.shiftKey;
        })
        .on('start', () => {
            setIsPanning(true);
        })
        .on('zoom', (event) => {
            transformRef.current = event.transform;
            setZoomLevel(event.transform.k); // Update store for UI
            requestAnimationFrame(draw);
        })
        .on('end', () => {
            setIsPanning(false);
        });

    zoomBehaviorRef.current = zoom;

    d3.select(canvas)
        .call(zoom)
        .call(zoom.transform, d3.zoomIdentity.translate(dimsRef.current.width/2, dimsRef.current.height/2).scale(0.1)); // Start zoomed out

    // MouseDown to start dragging
    d3.select(canvas).on('mousedown', (event) => {
        const state = useMapStore.getState();
        const [mx, my] = d3.pointer(event, canvas);
        const t = transformRef.current;
        const x = (mx - t.x) / t.k;
        const y = (my - t.y) / t.k;

        // Connect Tool active press handling
        const isConnActive = useMapStore.getState().isConnectToolActive;
        if (isConnActive) {
            // Check 1: Is a Node clicked/hovered? (Highest Priority)
            let clickedNode = null;
            if (state.hoveredEntityId) {
                clickedNode = state.entities.find(e => e.id === state.hoveredEntityId) || null;
            }
            if (!clickedNode) {
                let activeEntities: any[] = activeEntitiesRef.current || [];
                for (const ent of activeEntities) {
                    const radius = getEntityRadius(ent);
                    const hitArea = Math.max(radius * 1.5, 20 / t.k);
                    const dx = ent.x - x;
                    const dy = ent.y - y;
                    if (dx * dx + dy * dy <= hitArea * hitArea) {
                        clickedNode = ent;
                        break;
                    }
                }
            }

            // Check 2: If no node was clicked, check if Sub-Cluster connection dot / outline is targeted
            let subTarget: { domain: string; subIdx: number; title: string; x: number; y: number } | null = null;
            if (!clickedNode) {
                if (hoveredSubClusterOutlineRef.current) {
                    const dot = hoveredSubClusterOutlineRef.current;
                    subTarget = { domain: dot.domain, subIdx: dot.subIdx, title: dot.title, x: dot.x, y: dot.y };
                } else if (hoveredSubClusterRef.current) {
                    const h = hoveredSubClusterRef.current;
                    const sc = state.subClusters.find(s => s.domain === h.domain && s.sub_idx === h.subIdx);
                    const outline = subClusterOutlinesRef.current.find(o => o.domain === h.domain && o.subIdx === h.subIdx);
                    const label = subClusterLabelMetricsRef.current.find(l => l.domain === h.domain && l.subIdx === h.subIdx);
                    const title = sc ? sc.title : (outline ? outline.title : `SEC-0${h.subIdx + 1}`);
                    const cx = label ? label.x : (outline ? outline.centerX : x);
                    const cy = label ? label.y : (outline ? outline.centerY : y);
                    subTarget = { domain: h.domain, subIdx: h.subIdx, title, x: cx, y: cy };
                } else {
                    for (const outline of subClusterOutlinesRef.current) {
                        const isInside = outline.vertices && outline.vertices.length >= 3 && d3.polygonContains(outline.vertices, [x, y]);
                        const { point, distSq } = getClosestPointOnPolygon([x, y], outline.vertices);
                        const dist = Math.sqrt(distSq);
                        if (isInside || dist * t.k <= 25) {
                            subTarget = {
                                domain: outline.domain,
                                subIdx: outline.subIdx,
                                title: outline.title,
                                x: point[0],
                                y: point[1]
                            };
                            break;
                        }
                    }
                }
            }

            // Execute node click selection
            if (clickedNode) {
                const currentSource = connectSourceRef.current;
                if (!currentSource) {
                    updateConnectSource({
                        type: 'node',
                        id: clickedNode.id,
                        title: clickedNode.title,
                        x: clickedNode.x,
                        y: clickedNode.y
                    });
                } else {
                    const isSame = currentSource.type === 'node' && currentSource.id === clickedNode.id;
                    if (!isSame) {
                        handleCompleteConnection({
                            type: 'node',
                            id: clickedNode.id,
                            title: clickedNode.title,
                            x: clickedNode.x,
                            y: clickedNode.y
                        });
                        return;
                    } else {
                        updateConnectSource(null);
                        requestAnimationFrame(draw);
                        return;
                    }
                }
                isDraggingConnectLineRef.current = true;
                hasDraggedRef.current = false;
                requestAnimationFrame(draw);
                return;
            }

            // Execute sub-cluster click selection
            if (subTarget) {
                // Save connection dot coordinates for edge rendering
                const dotIdx = subClusterConnectionDotsRef.current.findIndex(d => d.domain === subTarget.domain && d.subIdx === subTarget.subIdx);
                const dotObj = {
                    domain: subTarget.domain,
                    subIdx: subTarget.subIdx,
                    title: subTarget.title,
                    x: subTarget.x,
                    y: subTarget.y,
                    color: '#818cf8'
                };
                if (dotIdx >= 0) {
                    subClusterConnectionDotsRef.current[dotIdx] = dotObj;
                } else {
                    subClusterConnectionDotsRef.current.push(dotObj);
                }

                const currentSource = connectSourceRef.current;
                if (!currentSource) {
                    updateConnectSource({
                        type: 'subcluster',
                        domain: subTarget.domain,
                        subIdx: subTarget.subIdx,
                        title: subTarget.title,
                        x: subTarget.x,
                        y: subTarget.y
                    });
                } else {
                    const isSame = currentSource.type === 'subcluster' && currentSource.domain === subTarget.domain && currentSource.subIdx === subTarget.subIdx;
                    if (!isSame) {
                        handleCompleteConnection({
                            type: 'subcluster',
                            domain: subTarget.domain,
                            subIdx: subTarget.subIdx,
                            title: subTarget.title,
                            x: subTarget.x,
                            y: subTarget.y
                        });
                        return;
                    } else {
                        updateConnectSource(null);
                        requestAnimationFrame(draw);
                        return;
                    }
                }
                isDraggingConnectLineRef.current = true;
                hasDraggedRef.current = false;
                requestAnimationFrame(draw);
                return;
            } else {
                if (connectSourceRef.current) {
                    updateConnectSource(null);
                    requestAnimationFrame(draw);
                    return;
                }
            }
        }

        // Shift + Drag background selection box trigger
        if (event.shiftKey) {
            const hoveringSubCluster = (viewMode === 'cluster' || viewMode === 'edit') && hoveredSubClusterRef.current !== null;
            if (!state.hoveredEntityId && !hoveringSubCluster) {
                isSelectingBoxRef.current = true;
                selectionStartRef.current = { x, y };
                selectionEndRef.current = { x, y };
                canvas.style.cursor = 'crosshair';
                requestAnimationFrame(draw);
                return;
            }
        }

        if (viewMode === 'edit' && hoveredSubClusterRef.current) {
            const h = hoveredSubClusterRef.current;
            selectedSubClusterRef.current = { domain: h.domain, subIdx: h.subIdx };
            
            const label = subClusterLabelMetricsRef.current.find(l => l.domain === h.domain && l.subIdx === h.subIdx);
            if (label) {
                if (h.isRotateHandle) {
                    isRotatingSubClusterRef.current = true;
                    isDraggingSubClusterRef.current = false;
                } else {
                    isDraggingSubClusterRef.current = true;
                    isRotatingSubClusterRef.current = false;
                    dragSubClusterStartOffsetRef.current = {
                        x: x - label.x,
                        y: y - label.y
                    };
                }
                hasDraggedRef.current = false; // Reset on mousedown
                canvas.style.cursor = h.isRotateHandle ? 'crosshair' : 'grabbing';
                requestAnimationFrame(draw);
                return;
            }
        }

        if (state.hoveredEntityId) {
            const entity = state.entities.find(e => e.id === state.hoveredEntityId);
            if (entity) {
                // Moving nodes is only allowed in 'edit' or 'graph' mode
                if (viewMode === 'edit' || viewMode === 'graph') {
                    isDraggingRef.current = true;
                    hasDraggedRef.current = false; // Reset on mousedown
                    draggedEntityIdRef.current = entity.id;

                    // Handle multi-selection state on dragging
                    if (!selectedEntityIdsRef.current.has(entity.id)) {
                        if (!event.shiftKey) {
                            selectedEntityIdsRef.current.clear();
                        } else {
                            selectedEntityIdsRef.current.add(entity.id);
                        }
                    }

                    // Cache starting coordinates for all nodes that will be moved simultaneously
                    dragStartCoordinatesRef.current.clear();
                    selectedEntityIdsRef.current.forEach(id => {
                        const ent = state.entities.find(e => e.id === id);
                        if (ent) {
                            dragStartCoordinatesRef.current.set(id, { x: ent.x, y: ent.y });
                        }
                    });
                    dragStartCoordinatesRef.current.set(entity.id, { x: entity.x, y: entity.y });

                    dragOffsetRef.current = {
                        x: x - entity.x,
                        y: y - entity.y
                    };
                    canvas.style.cursor = 'grabbing';
                }
                requestAnimationFrame(draw);
            }
        }
    });

    // Interaction handling (Click / Hover / Dragging)
    d3.select(canvas).on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, canvas);
        const t = transformRef.current;
        // Transform screen coordinates back to map coordinates
        const x = (mx - t.x) / t.k;
        const y = (my - t.y) / t.k;
        
        mouseWorldPosRef.current = { x, y };

        if (isSelectingBoxRef.current) {
            selectionEndRef.current = { x, y };
            canvas.style.cursor = 'crosshair';
            requestAnimationFrame(draw);
            return;
        }

        if (isDraggingRef.current && draggedEntityIdRef.current) {
            hasDraggedRef.current = true; // Mark as dragged
            const primaryId = draggedEntityIdRef.current;
            const primaryStart = dragStartCoordinatesRef.current.get(primaryId);
            
            if (primaryStart) {
                const primaryNewX = x - dragOffsetRef.current.x;
                const primaryNewY = y - dragOffsetRef.current.y;
                const deltaX = primaryNewX - primaryStart.x;
                const deltaY = primaryNewY - primaryStart.y;
                
                const state = useMapStore.getState();
                const clusters = state.clusters;
                
                // If dragging a multi-selected node, update all of them
                if (selectedEntityIdsRef.current.has(primaryId) && selectedEntityIdsRef.current.size > 1) {
                    selectedEntityIdsRef.current.forEach(id => {
                        const startPos = dragStartCoordinatesRef.current.get(id);
                        if (startPos) {
                            const updatedX = startPos.x + deltaX;
                            const updatedY = startPos.y + deltaY;
                            
                            updateEntityCoordinatesInStore(id, updatedX, updatedY, undefined);
                        }
                    });
                } else {
                    // Dragging a single node
                    updateEntityCoordinatesInStore(primaryId, primaryNewX, primaryNewY, undefined);
                }
            }
            canvas.style.cursor = 'grabbing';
            requestAnimationFrame(draw);
            return;
        }

        if (isDraggingSubClusterRef.current && selectedSubClusterRef.current) {
            hasDraggedRef.current = true;
            const sub = selectedSubClusterRef.current;
            const newX = x - dragSubClusterStartOffsetRef.current.x;
            const newY = y - dragSubClusterStartOffsetRef.current.y;
            
            const { subClusters, setSubClusters } = useMapStore.getState();
            const exists = subClusters.some(sc => sc.domain === sub.domain && sc.sub_idx === sub.subIdx);
            let updated;
            if (exists) {
                updated = subClusters.map(sc => 
                    sc.domain === sub.domain && sc.sub_idx === sub.subIdx 
                        ? { ...sc, x: newX, y: newY } 
                        : sc
                );
            } else {
                updated = [...subClusters, { domain: sub.domain, sub_idx: sub.subIdx, title: sub.domain, x: newX, y: newY }];
            }
            setSubClusters(updated);
            canvas.style.cursor = 'grabbing';
            requestAnimationFrame(draw);
            return;
        }

        if (isRotatingSubClusterRef.current && selectedSubClusterRef.current) {
            hasDraggedRef.current = true;
            const sub = selectedSubClusterRef.current;
            const label = subClusterLabelMetricsRef.current.find(l => l.domain === sub.domain && l.subIdx === sub.subIdx);
            if (label) {
                const currentAngleRad = Math.atan2(y - label.y, x - label.x);
                let newAngleDeg = (currentAngleRad + Math.PI / 2) * 180 / Math.PI;
                while (newAngleDeg > 180) newAngleDeg -= 360;
                while (newAngleDeg < -180) newAngleDeg += 360;
                
                const { subClusters, setSubClusters } = useMapStore.getState();
                const exists = subClusters.some(sc => sc.domain === sub.domain && sc.sub_idx === sub.subIdx);
                let updated;
                if (exists) {
                    updated = subClusters.map(sc => 
                        sc.domain === sub.domain && sc.sub_idx === sub.subIdx 
                            ? { ...sc, angle: newAngleDeg } 
                            : sc
                    );
                } else {
                    updated = [...subClusters, { domain: sub.domain, sub_idx: sub.subIdx, title: sub.domain, angle: newAngleDeg }];
                }
                setSubClusters(updated);
                canvas.style.cursor = 'crosshair';
                requestAnimationFrame(draw);
                return;
            }
        }
        
        const state = useMapStore.getState();
        const { 
          entities: rawEntities, searchQuery, stageFilters, minRelevance, 
          selectedDomains, selectedTypes, selectedTags, excludedSubTags, viewMode
        } = state;

        const isConnActive = state.isConnectToolActive;

        // Check if hovering a sub-cluster label
        let hoveredSub = null;
        if (viewMode === 'edit' || isConnActive) {
            for (const label of subClusterLabelMetricsRef.current) {
                // 1. Check rotate handle hit first
                const handleLocalX = 0;
                const handleLocalY = -label.height / 2 - 18;
                const handleRad = label.angle * Math.PI / 180;
                const handleX = label.x + handleLocalX * Math.cos(handleRad) - handleLocalY * Math.sin(handleRad);
                const handleY = label.y + handleLocalX * Math.sin(handleRad) + handleLocalY * Math.cos(handleRad);
                
                const distToHandle = Math.hypot(x - handleX, y - handleY);
                if (distToHandle <= 10 / t.k) {
                    hoveredSub = { domain: label.domain, subIdx: label.subIdx, isRotateHandle: true };
                    break;
                }
                
                // 2. Check label hit
                const dx = x - label.x;
                const dy = y - label.y;
                const rad = -label.angle * Math.PI / 180;
                const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
                const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
                
                if (Math.abs(localX) <= label.width / 2 && Math.abs(localY) <= label.height / 2) {
                    hoveredSub = { domain: label.domain, subIdx: label.subIdx, isRotateHandle: false };
                    break;
                }
            }
        }

        const prevHoveredSub = hoveredSubClusterRef.current;
        const hoverChanged = !prevHoveredSub || !hoveredSub || 
                             prevHoveredSub.domain !== hoveredSub.domain || 
                             prevHoveredSub.subIdx !== hoveredSub.subIdx ||
                             prevHoveredSub.isRotateHandle !== hoveredSub.isRotateHandle;
        
        if (hoverChanged) {
            hoveredSubClusterRef.current = hoveredSub;
            requestAnimationFrame(draw);
        }
        
        if (hoveredSub && !isConnActive) {
            canvas.style.cursor = hoveredSub.isRotateHandle ? 'crosshair' : 'move';
            if (state.hoveredEntityId) {
                hoverEntity(null);
            }
            hoveredSubClusterOutlineRef.current = null;
            return;
        }
        
        // 1. Check Node Entity Hover (Highest Priority)
        let activeEntities: any[] = activeEntitiesRef.current || [];
        
        let closest = null;
        let minDist = Infinity;
        activeEntities.forEach(e => {
            const radius = getEntityRadius(e);
            const hitArea = Math.max(radius * 1.5, 20 / t.k); 
            
            const dx = e.x - x;
            const dy = e.y - y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < hitArea && dist < minDist) {
                minDist = dist;
                closest = e;
            }
        });

        // 2. Check Sub-Cluster Outline / Connection Dot hover when Connect Tool is active (only if no node entity is hovered)
        let hoveredOutline: typeof hoveredSubClusterOutlineRef.current = null;
        if (isConnActive && !closest) {
            let bestOutline: typeof hoveredSubClusterOutlineRef.current = null;
            let minOutlineDist = Infinity;

            for (const outline of subClusterOutlinesRef.current) {
                if (!outline.vertices || outline.vertices.length < 3) continue;
                const { point, distSq } = getClosestPointOnPolygon([x, y], outline.vertices);
                const distScreen = Math.sqrt(distSq) * t.k;
                const isInside = d3.polygonContains(outline.vertices, [x, y]);

                if (distScreen <= 35 || isInside) {
                    if (distScreen < minOutlineDist) {
                        minOutlineDist = distScreen;
                        bestOutline = {
                            domain: outline.domain,
                            subIdx: outline.subIdx,
                            title: outline.title,
                            color: outline.color,
                            x: point[0],
                            y: point[1],
                            vertices: outline.vertices
                        };
                    }
                }
            }

            if (bestOutline) {
                hoveredOutline = bestOutline;
            }
        }

        const currentHover = state.hoveredEntityId;
        const newHover = closest ? closest.id : null;

        if (newHover !== currentHover) {
            hoverEntity(newHover);
        }

        const prevOutline = hoveredSubClusterOutlineRef.current;
        const outlineChanged = (!prevOutline && hoveredOutline) || 
                               (prevOutline && !hoveredOutline) || 
                               (prevOutline && hoveredOutline && (
                                   prevOutline.domain !== hoveredOutline.domain || 
                                   prevOutline.subIdx !== hoveredOutline.subIdx || 
                                   Math.hypot(prevOutline.x - hoveredOutline.x, prevOutline.y - hoveredOutline.y) > 0.5
                               ));

        hoveredSubClusterOutlineRef.current = hoveredOutline;

        // 3. Check Relationship Line hover (if no node entity, outline dot, or subcluster label is hovered)
        let hoveredRel: any = null;
        if (!closest && !hoveredOutline && !hoveredSub) {
            let minRelDistScreen = Infinity;
            for (const item of renderedLinksRef.current) {
                const d = distToSegment(x, y, item.x1, item.y1, item.x2, item.y2);
                const distScreen = d * t.k;
                if (distScreen <= 12 && distScreen < minRelDistScreen) {
                    minRelDistScreen = distScreen;
                    hoveredRel = item.rel;
                }
            }
        }

        const prevHoveredRel = hoveredRelationshipRef.current;
        if (prevHoveredRel !== hoveredRel) {
            hoveredRelationshipRef.current = hoveredRel;
            requestAnimationFrame(draw);
        }

        // Check soft link badge hover (only if cursor is not on the node circle itself)
        let hoveredBadge = null;
        for (const hit of softLinkBadgeHitsRef.current) {
            const distToBadge = Math.hypot(x - hit.badgeX, y - hit.badgeY);
            const nodeRadius = getEntityRadius(hit.entity);
            const distToNode = Math.hypot(x - hit.entity.x, y - hit.entity.y);

            if (distToNode <= nodeRadius * 1.05) {
                continue;
            }

            if (distToBadge <= hit.badgeRadius * 1.0) {
                hoveredBadge = hit;
                break;
            }
        }
        hoveredSoftBadgeRef.current = hoveredBadge;

        if (hoveredBadge) {
            canvas.style.cursor = 'pointer';
            return;
        }

        if (newHover || hoveredOutline || hoveredSub || hoveredRel) {
            canvas.style.cursor = isConnActive ? 'crosshair' : 'pointer';
            if (newHover !== currentHover || outlineChanged || prevHoveredRel !== hoveredRel) {
                requestAnimationFrame(draw);
            }
            return;
        }

        if (prevOutline !== null || currentHover !== null || prevHoveredRel !== null) {
            requestAnimationFrame(draw);
        }
        canvas.style.cursor = 'grab';
    });

    // MouseUp to finish dragging or selection
    d3.select(canvas).on('mouseup', () => {
        if (isDraggingConnectLineRef.current) {
            isDraggingConnectLineRef.current = false;
            const state = useMapStore.getState();
            let targetItem: any = null;

            if (hoveredSubClusterOutlineRef.current) {
                const dot = hoveredSubClusterOutlineRef.current;
                targetItem = { type: 'subcluster', domain: dot.domain, subIdx: dot.subIdx, title: dot.title, x: dot.x, y: dot.y };
            } else if (state.hoveredEntityId) {
                const ent = state.entities.find(e => e.id === state.hoveredEntityId);
                if (ent) {
                    targetItem = { type: 'node', id: ent.id, title: ent.title, x: ent.x, y: ent.y };
                }
            } else if (hoveredSubClusterRef.current) {
                const h = hoveredSubClusterRef.current;
                const sc = state.subClusters.find(s => s.domain === h.domain && s.sub_idx === h.subIdx);
                const label = subClusterLabelMetricsRef.current.find(l => l.domain === h.domain && l.subIdx === h.subIdx);
                targetItem = { type: 'subcluster', domain: h.domain, subIdx: h.subIdx, title: sc ? sc.title : `SEC-0${h.subIdx + 1}`, x: label?.x || 0, y: label?.y || 0 };
            }

            const currentSource = connectSourceRef.current;
            if (targetItem && currentSource) {
                const isSame = (currentSource.type === targetItem.type) &&
                    ((currentSource.type === 'node' && currentSource.id === targetItem.id) ||
                     (currentSource.type === 'subcluster' && currentSource.domain === targetItem.domain && currentSource.subIdx === targetItem.subIdx));

                if (!isSame) {
                    handleCompleteConnection(targetItem);
                }
            }
            requestAnimationFrame(draw);
            return;
        }

        if (isSelectingBoxRef.current) {
            isSelectingBoxRef.current = false;
            canvas.style.cursor = 'grab';
            
            const x1 = Math.min(selectionStartRef.current.x, selectionEndRef.current.x);
            const x2 = Math.max(selectionStartRef.current.x, selectionEndRef.current.x);
            const y1 = Math.min(selectionStartRef.current.y, selectionEndRef.current.y);
            const y2 = Math.max(selectionStartRef.current.y, selectionEndRef.current.y);
            
            const boxWidth = x2 - x1;
            const boxHeight = y2 - y1;
            
            if (boxWidth > 5 && boxHeight > 5) {
                const state = useMapStore.getState();
                const currentActive = (state.viewMode === 'graph' && simNodesRef.current && simNodesRef.current.length > 0)
                    ? simNodesRef.current
                    : activeEntitiesRef.current;
                
                selectedEntityIdsRef.current.clear();
                currentActive.forEach(entity => {
                    if (entity.x >= x1 && entity.x <= x2 && entity.y >= y1 && entity.y <= y2) {
                        selectedEntityIdsRef.current.add(entity.id);
                    }
                });
                selectEntity(null); // Clear single selection
            }
            requestAnimationFrame(draw);
            return;
        }

        if ((isDraggingSubClusterRef.current || isRotatingSubClusterRef.current) && selectedSubClusterRef.current) {
            const sub = selectedSubClusterRef.current;
            isDraggingSubClusterRef.current = false;
            isRotatingSubClusterRef.current = false;
            canvas.style.cursor = 'grab';
            
            const { subClusters } = useMapStore.getState();
            const sc = subClusters.find(s => s.domain === sub.domain && s.sub_idx === sub.subIdx);
            if (sc) {
                fetch('/api/sub-clusters/update-geometry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        domain: sc.domain,
                        sub_idx: sc.sub_idx,
                        title: sc.title || sc.domain,
                        x: sc.x !== undefined ? sc.x : null,
                        y: sc.y !== undefined ? sc.y : null,
                        angle: sc.angle !== undefined ? sc.angle : null
                    })
                })
                .then(res => res.json())
                .catch(err => console.error("Failed to save sub-cluster geometry:", err));
            }
            requestAnimationFrame(draw);
            return;
        }

        if (isDraggingRef.current && draggedEntityIdRef.current) {
            isDraggingRef.current = false;
            canvas.style.cursor = 'grab';
            
            const state = useMapStore.getState();
            const primaryId = draggedEntityIdRef.current;
            
            if (selectedEntityIdsRef.current.has(primaryId) && selectedEntityIdsRef.current.size > 1) {
                const updates: Array<{ id: string, x: number, y: number, domain: string }> = [];
                selectedEntityIdsRef.current.forEach(id => {
                    const ent = state.entities.find(e => e.id === id);
                    if (ent) {
                        updates.push({
                            id: ent.id,
                            x: ent.x,
                            y: ent.y,
                            domain: ent.domain
                        });
                    }
                });
                
                fetch('/api/entities/update-coordinates-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ updates })
                })
                .then(res => res.json())
                .catch(err => console.error("Failed to save batch coordinates:", err));
            } else {
                const entity = state.entities.find(e => e.id === primaryId);
                if (entity) {
                    fetch('/api/entities/update-coordinates', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: entity.id,
                            x: entity.x,
                            y: entity.y,
                            domain: entity.domain
                        })
                    })
                    .then(res => res.json())
                    .catch(err => console.error("Failed to save coordinates:", err));
                }
            }
            draggedEntityIdRef.current = null;
            requestAnimationFrame(draw);
        }
    });

    // MouseLeave as fallback
    d3.select(canvas).on('mouseleave', () => {
        isSelectingBoxRef.current = false;

        if ((isDraggingSubClusterRef.current || isRotatingSubClusterRef.current) && selectedSubClusterRef.current) {
            const sub = selectedSubClusterRef.current;
            isDraggingSubClusterRef.current = false;
            isRotatingSubClusterRef.current = false;
            canvas.style.cursor = 'grab';
            
            const { subClusters } = useMapStore.getState();
            const sc = subClusters.find(s => s.domain === sub.domain && s.sub_idx === sub.subIdx);
            if (sc) {
                fetch('/api/sub-clusters/update-geometry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        domain: sc.domain,
                        sub_idx: sc.sub_idx,
                        title: sc.title || sc.domain,
                        x: sc.x !== undefined ? sc.x : null,
                        y: sc.y !== undefined ? sc.y : null,
                        angle: sc.angle !== undefined ? sc.angle : null
                    })
                })
                .then(res => res.json())
                .catch(err => console.error("Failed to save sub-cluster geometry:", err));
            }
            requestAnimationFrame(draw);
            return;
        }

        if (isDraggingRef.current && draggedEntityIdRef.current) {
            isDraggingRef.current = false;
            canvas.style.cursor = 'grab';
            
            const state = useMapStore.getState();
            const primaryId = draggedEntityIdRef.current;
            
            if (selectedEntityIdsRef.current.has(primaryId) && selectedEntityIdsRef.current.size > 1) {
                const updates: Array<{ id: string, x: number, y: number, domain: string }> = [];
                selectedEntityIdsRef.current.forEach(id => {
                    const ent = state.entities.find(e => e.id === id);
                    if (ent) {
                        updates.push({
                            id: ent.id,
                            x: ent.x,
                            y: ent.y,
                            domain: ent.domain
                        });
                    }
                });
                
                fetch('/api/entities/update-coordinates-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ updates })
                })
                .then(res => res.json())
                .catch(err => console.error("Failed to save batch coordinates:", err));
            } else {
                const entity = state.entities.find(e => e.id === primaryId);
                if (entity) {
                    fetch('/api/entities/update-coordinates', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: entity.id,
                            x: entity.x,
                            y: entity.y,
                            domain: entity.domain
                        })
                    })
                    .then(res => res.json())
                    .catch(err => console.error("Failed to save coordinates:", err));
                }
            }
            draggedEntityIdRef.current = null;
            requestAnimationFrame(draw);
        }
    });

    d3.select(canvas).on('click', (event) => {
        if (hasDraggedRef.current) {
            hasDraggedRef.current = false;
            return;
        }
        if (isDraggingRef.current) return;
        if (isDraggingSubClusterRef.current || isRotatingSubClusterRef.current) return;

        const state = useMapStore.getState();

        // Connect Tool Line Creation Logic
        const isConnActive = useMapStore.getState().isConnectToolActive;
        if (isConnActive) {
            requestAnimationFrame(draw);
            return; // Connect Tool press/click is handled in mousedown/mouseup
        }

        if (hoveredSoftBadgeRef.current) {
            setLinkModalData({
                title: 'Soft Links',
                subtitle: `Connected to ${hoveredSoftBadgeRef.current.entity.title}`,
                entity: hoveredSoftBadgeRef.current.entity,
                links: hoveredSoftBadgeRef.current.softLinks
            });
            setActiveLineLabelRelId(null);
            activeLineLabelRelIdRef.current = null;
            return;
        }

        if (hoveredRelationshipRef.current) {
            const rel = hoveredRelationshipRef.current;
            if (viewMode === 'edit') {
                openEditRelationshipModal(rel);
                return;
            }

            const userNote = (rel.evidence || '')
                .replace(/\[style:\s*[^\]]+\]/gi, '')
                .replace(/\[pos:\s*[^\]]+\]/gi, '')
                .replace(/\[soft:\s*[^\]]+\]/gi, '')
                .replace(/\[link_type:\s*[^\]]+\]/gi, '')
                .replace(/manually created connection/gi, '')
                .replace(/manually created soft link/gi, '')
                .trim();

            if (userNote.length > 0) {
                const srcId = typeof rel.source === 'object' ? rel.source.id : rel.source;
                const tgtId = typeof rel.target === 'object' ? rel.target.id : rel.target;
                const srcEntity = entities.find(e => e.id === srcId);
                const tgtEntity = entities.find(e => e.id === tgtId);

                const srcTitle = srcEntity ? srcEntity.title : srcId;
                const tgtTitle = tgtEntity ? tgtEntity.title : tgtId;

                setLinkModalData({
                    title: 'Links',
                    subtitle: `${srcTitle} ↔ ${tgtTitle}`,
                    links: [rel]
                });
                setActiveLineLabelRelId(null);
                activeLineLabelRelIdRef.current = null;
            } else {
                const nextId = activeLineLabelRelIdRef.current === rel.id ? null : rel.id;
                setActiveLineLabelRelId(nextId);
                activeLineLabelRelIdRef.current = nextId;
                setLinkModalData(null);
            }
            requestAnimationFrame(draw);
            return;
        }

        // Clear active line label if clicking on blank canvas or another element
        if (activeLineLabelRelIdRef.current) {
            setActiveLineLabelRelId(null);
            activeLineLabelRelIdRef.current = null;
        }

        if (viewMode === 'edit' && hoveredSubClusterRef.current) {
            const h = hoveredSubClusterRef.current;
            selectedSubClusterRef.current = { domain: h.domain, subIdx: h.subIdx };
            selectEntity(null);
            selectedEntityIdsRef.current.clear();
        } else {
            selectedSubClusterRef.current = null;
            if (state.hoveredEntityId) {
                if (event.shiftKey) {
                    if (selectedEntityIdsRef.current.has(state.hoveredEntityId)) {
                        selectedEntityIdsRef.current.delete(state.hoveredEntityId);
                    } else {
                        selectedEntityIdsRef.current.add(state.hoveredEntityId);
                    }
                    selectEntity(null); // Clear single selection
                } else {
                    selectedEntityIdsRef.current.clear();
                    selectEntity(state.hoveredEntityId);
                }
            } else {
                if (!event.shiftKey) {
                    selectedEntityIdsRef.current.clear();
                    selectEntity(null);
                }
            }
        }
        requestAnimationFrame(draw);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            selectedEntityIdsRef.current.clear();
            selectEntity(null);
            updateConnectSource(null);
            setConnectToolActive(false);
            setRelationshipModal(null);
            requestAnimationFrame(draw);
        }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
        window.removeEventListener('resize', resize);
        window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewMode]); // Setup D3 zoom and canvas events only once on mount to preserve zoom/panning transforms

  // Re-draw if data, selected or hovered changes from outside (e.g. sidebar)
  useEffect(() => {
      requestAnimationFrame(draw);
  }, [entities, relationships, selectedEntityId, hoveredEntityId, searchQuery, stageFilters, minRelevance, selectedDomains, selectedTypes, selectedTags, excludedSubTags, viewMode, subClusters, isConnectToolActive, connectLineStyle]);

  // Use the active/simulation nodes to find the coordinates of hoveredEntity
  const activeEntities = (viewMode === 'graph' && simNodesRef.current && simNodesRef.current.length > 0)
    ? simNodesRef.current
    : entities;
  
  const hoveredEntity = activeEntities.find(e => e.id === hoveredEntityId);
  let tooltipPosition = null;
  if (hoveredEntity && transformRef.current) {
      const t = transformRef.current;
      tooltipPosition = {
          x: hoveredEntity.x * t.k + t.x,
          y: hoveredEntity.y * t.k + t.y,
      };
  }



  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#050608] group">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-grab active:cursor-grabbing z-10" />
        
        {/* Connect Tool Active Indicator Badge */}
        {isConnectToolActive && (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-[#0a0c14]/95 backdrop-blur-md border border-indigo-500/40 rounded-full px-4 py-2 shadow-2xl text-xs font-sans transition-all animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
              </span>
              {connectSource ? (
                <span className="text-slate-200">
                  <strong className="text-indigo-400 font-semibold font-mono">1st Element Selected:</strong>{' '}
                  <strong className="text-white font-medium">{connectSource.title}</strong>{' '}
                  <span className="text-slate-400 font-mono text-[11px]">({connectSource.type === 'node' ? 'Node' : 'Sub-cluster'})</span>
                  <span className="text-indigo-300 ml-2">→ Click 2nd element to connect</span>
                </span>
              ) : (
                <span className="text-slate-300 font-mono">
                  <strong className="text-indigo-400 font-semibold">Connect Mode:</strong> Click any <strong className="text-white font-medium">Node</strong> or <strong className="text-white font-medium">Sub-cluster</strong> as 1st element
                </span>
              )}
            </div>
            {connectSource ? (
              <button
                onClick={() => {
                  updateConnectSource(null);
                  requestAnimationFrame(draw);
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 text-[11px] font-mono transition-colors"
                title="Clear 1st element selection"
              >
                <X className="w-3 h-3" />
                <span>Clear</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  useMapStore.getState().setConnectToolActive(false);
                  updateConnectSource(null);
                  requestAnimationFrame(draw);
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 text-[11px] font-mono transition-colors"
                title="Exit Connect Mode"
              >
                <X className="w-3 h-3" />
                <span>Exit</span>
              </button>
            )}
          </div>
        )}

        {/* Relationship Creation Modal Pop-up */}
        {relationshipModal?.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-[#0f121d] border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden font-sans text-slate-200 animate-in fade-in zoom-in-95 duration-200">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                  <Link2 className="w-4 h-4" />
                  <span>{relationshipModal.isEdit ? 'Edit Relationship Link' : 'Add Map Relationship Link'}</span>
                </div>
                <button
                  onClick={() => {
                    setRelationshipModal(null);
                    updateConnectSource(null);
                    requestAnimationFrame(draw);
                  }}
                  className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                {/* Connection Source -> Target summary */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-xs">
                  <div className="flex-1 text-center">
                    <div className="text-[10px] text-slate-400 uppercase font-mono">From</div>
                    <div className="font-semibold text-white mt-0.5 truncate max-w-[140px]">{relationshipModal.sourceEntity.title}</div>
                  </div>
                  <div className="px-2 text-indigo-400 font-mono font-bold">→</div>
                  <div className="flex-1 text-center">
                    <div className="text-[10px] text-slate-400 uppercase font-mono">To</div>
                    <div className="font-semibold text-white mt-0.5 truncate max-w-[140px]">{relationshipModal.targetEntity.title}</div>
                  </div>
                </div>

                {/* Line Style Selection */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Line Visual Style
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setModalStyle('solid')}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border transition-all ${
                        modalStyle === 'solid'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-bold shadow-lg shadow-indigo-500/20'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      <span className="text-indigo-400">──────</span>
                      <span>Solid Line</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalStyle('dotted')}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border transition-all ${
                        modalStyle === 'dotted'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-bold shadow-lg shadow-indigo-500/20'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      <span className="text-indigo-400">- - - -</span>
                      <span>Dotted Line</span>
                    </button>
                  </div>
                </div>

                {/* Relationship Type & Visible Checkbox */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Relationship Type
                    </label>
                    <select
                      value={modalType}
                      onChange={(e) => setModalType(e.target.value)}
                      className="w-full bg-[#161a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors font-mono uppercase"
                    >
                      <option value="references">References / Links To</option>
                      <option value="builds_on">Builds On</option>
                      <option value="inspired_by">Inspired By</option>
                      <option value="extends">Extends / Expands</option>
                      <option value="cites">Cites / Sources</option>
                      <option value="critiques">Critiques / Responds To</option>
                      <option value="created_by">Created By / Authored By</option>
                      <option value="uses">Uses / Implements</option>
                      <option value="related_to">Related To</option>
                    </select>
                  </div>
                  <div className="flex flex-col justify-end pt-5">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Visibility
                    </label>
                    <select
                      value={modalVisibilityMode}
                      onChange={(e) => setModalVisibilityMode(e.target.value as 'visible' | 'soft_link' | 'not_visible')}
                      className="bg-[#161a29] border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="visible">visible</option>
                      <option value="soft_link">soft link</option>
                      <option value="not_visible">not visible</option>
                    </select>
                  </div>
                </div>

                {/* Evidence / Description */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Notes / Context (Optional)
                  </label>
                  <textarea
                    value={modalEvidence}
                    onChange={(e) => setModalEvidence(e.target.value)}
                    placeholder="Describe why these entities or sub-clusters are connected..."
                    rows={2}
                    className="w-full bg-[#161a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-white/10 bg-white/[0.02]">
                {relationshipModal.isEdit ? (
                  <button
                    type="button"
                    disabled={isSubmittingRel}
                    onClick={handleDeleteRelationshipInModal}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Link</span>
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRelationshipModal(null);
                      updateConnectSource(null);
                      requestAnimationFrame(draw);
                    }}
                    className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingRel}
                    onClick={handleCreateRelationshipSubmit}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
                  >
                    {isSubmittingRel ? (
                      <span>Saving...</span>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>{relationshipModal.isEdit ? 'Save Changes' : 'Add Relationship'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toast Notification Banner */}
        {toastMessage && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-xs px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Relationship Lines Toggle Button (Top Right, visible at Regional / Local zoom levels) */}
        {zoomLevel >= 0.3 && (
          <div className="absolute top-5 right-5 z-30">
            <button
              type="button"
              onMouseEnter={() => setIsEyeBtnHovered(true)}
              onMouseLeave={() => setIsEyeBtnHovered(false)}
              onClick={() => {
                const nextState = !showRelationshipLines;
                setShowRelationshipLines(nextState);
                showRelationshipLinesRef.current = nextState;
                requestAnimationFrame(draw);
              }}
              className={`relative p-2.5 rounded-xl backdrop-blur-md border shadow-xl transition-all cursor-pointer flex items-center justify-center ${
                showRelationshipLines
                  ? 'bg-[#0a0c10]/85 border-white/15 text-slate-300 hover:text-white hover:bg-white/10 hover:border-indigo-400/50'
                  : 'bg-indigo-950/80 border-indigo-500/50 text-indigo-400 hover:bg-indigo-900/80 hover:text-indigo-300'
              }`}
            >
              <div
                className={`absolute right-full mr-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-[#0a0c10]/95 border border-white/15 text-[11px] font-sans text-slate-200 shadow-2xl transition-opacity duration-150 pointer-events-none whitespace-nowrap ${
                  isEyeBtnHovered ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {showRelationshipLines ? 'hide relationship lines' : 'show relationship lines'}
              </div>
              {showRelationshipLines ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
        )}
        
        {/* Scale Indicator Overlay */}
        <div className="absolute bottom-6 left-6 pointer-events-none select-none z-20 bg-[#0a0c10]/80 backdrop-blur border border-white/10 rounded-lg px-3 py-1.5 shadow-2xl">
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                Atlas Scale: {zoomLevel < 0.1 ? 'World' : zoomLevel < 0.3 ? 'Continental' : zoomLevel < 0.8 ? 'Regional' : 'Local'}
            </div>
        </div>

        {/* Links / Soft Links List Modal */}
        {linkModalData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-lg bg-[#0f121d] border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden font-sans text-slate-200">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="font-semibold text-sm text-white">{linkModalData.title} ({linkModalData.links.length})</span>
                </div>
                <button
                  onClick={() => setLinkModalData(null)}
                  className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {linkModalData.subtitle && (
                <div className="px-5 py-3 bg-indigo-950/30 border-b border-indigo-500/20 text-xs text-slate-300">
                  {linkModalData.subtitle}
                </div>
              )}

              <div className="p-5 max-h-[350px] overflow-y-auto space-y-3">
                {linkModalData.links.map((rel: any) => {
                  let sourceName = '';
                  let targetName = '';
                  let otherEntity: Entity | undefined;
                  let targetNodeId: string | null = null;
                  let direction = '';

                  if (linkModalData.entity) {
                    const otherId = rel.source === linkModalData.entity.id ? rel.target : rel.source;
                    otherEntity = entities.find(e => e.id === otherId);
                    sourceName = otherEntity ? otherEntity.title : otherId;
                    targetNodeId = otherEntity ? otherEntity.id : null;
                    direction = rel.source === linkModalData.entity.id ? 'Outbound →' : '← Inbound';
                  } else {
                    const srcId = typeof rel.source === 'object' ? rel.source.id : rel.source;
                    const tgtId = typeof rel.target === 'object' ? rel.target.id : rel.target;
                    const srcEnt = entities.find(e => e.id === srcId);
                    const tgtEnt = entities.find(e => e.id === tgtId);
                    sourceName = srcEnt ? srcEnt.title : srcId;
                    targetName = tgtEnt ? tgtEnt.title : tgtId;
                    otherEntity = tgtEnt || srcEnt;
                    targetNodeId = tgtEnt ? tgtEnt.id : (srcEnt ? srcEnt.id : null);
                    direction = 'Connection';
                  }

                  // Clean note by stripping out system metadata tags and default text
                  const userNote = (rel.evidence || '')
                    .replace(/\[style:\s*[^\]]+\]/gi, '')
                    .replace(/\[pos:\s*[^\]]+\]/gi, '')
                    .replace(/\[soft:\s*[^\]]+\]/gi, '')
                    .replace(/\[link_type:\s*[^\]]+\]/gi, '')
                    .replace(/manually created connection/gi, '')
                    .replace(/manually created soft link/gi, '')
                    .trim();

                  return (
                    <div
                      key={rel.id || `${rel.source}-${rel.target}`}
                      className="p-3.5 rounded-xl bg-white/5 border border-white/10 hover:border-indigo-500/40 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold uppercase">
                            {rel.type || 'references'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 uppercase">
                            {direction}
                          </span>
                        </div>
                        <div className="font-semibold text-sm text-white truncate">
                          {linkModalData.entity ? sourceName : `${sourceName} → ${targetName}`}
                        </div>
                        {otherEntity && (() => {
                          const scObj = subClusters.find(s => s.domain === otherEntity.domain && s.sub_idx === otherEntity.sub_idx);
                          const scName = scObj?.title || (otherEntity.sub_idx !== undefined && otherEntity.sub_idx !== null ? `SEC-0${otherEntity.sub_idx + 1}` : undefined);
                          return (
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex flex-wrap items-center gap-x-2">
                              <span>Domain: <span className="text-indigo-300">{otherEntity.domain}</span></span>
                              {scName && (
                                <>
                                  <span className="text-slate-600">•</span>
                                  <span>Sub-cluster: <span className="text-indigo-300">{scName}</span></span>
                                </>
                              )}
                            </div>
                          );
                        })()}
                        {userNote.length > 0 && (
                          <div className="text-xs text-slate-300 mt-2 p-2 rounded bg-black/20 border border-white/5 italic line-clamp-2">
                            "{userNote}"
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          if (targetNodeId) {
                            selectEntity(targetNodeId);
                          }
                          setLinkModalData(null);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-colors flex-shrink-0 cursor-pointer"
                      >
                        See Node
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="px-5 py-3 border-t border-white/10 bg-white/[0.02] flex justify-end">
                <button
                  onClick={() => setLinkModalData(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Hover Tooltip Popup */}
        {hoveredEntity && tooltipPosition && !isPanning && (
          <div 
            className="absolute z-30 bg-[#0a0c10]/95 backdrop-blur-md border border-white/15 rounded-lg p-3 shadow-2xl pointer-events-none flex flex-col gap-1.5 min-w-[180px] font-sans text-left"
            style={{
              left: `${tooltipPosition.x}px`,
              top: `${tooltipPosition.y - 14}px`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {/* Title */}
            <div className="font-semibold text-xs text-white tracking-tight border-b border-white/5 pb-1">
              {hoveredEntity.title}
            </div>

            {/* Details Row */}
            <div className="flex justify-between items-center gap-2 text-[10px] font-mono">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Relevance:</span>
                <span className="text-indigo-400 font-bold">{hoveredEntity.relevance ?? 0}%</span>
              </div>
              {hoveredEntity.type && (
                <div className="flex items-center gap-1">
                  <span className="text-slate-500">Type:</span>
                  <span className="text-pink-400">{hoveredEntity.type}</span>
                </div>
              )}
              {hoveredEntity.stage && (
                <div className="flex items-center gap-1">
                  <span className="text-slate-500">Stage:</span>
                  <span className="text-amber-400">{hoveredEntity.stage}</span>
                </div>
              )}
            </div>

            {/* Tags */}
            {hoveredEntity.tags && hoveredEntity.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {hoveredEntity.tags.map((tag: string) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded-[4px] text-[8px] font-mono bg-white/5 text-slate-400 border border-white/5">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}

import * as d3 from 'd3';
import { Entity, Relationship, DomainCluster } from '../types';

const DOMAINS: Record<string, { color: string }> = {
  'Systems Thinking': { color: '#8b5cf6' }, // Violet
  'Artificial Intelligence': { color: '#3b82f6' }, // Blue
  'Cognitive Science': { color: '#ec4899' }, // Pink
  'Ecology': { color: '#10b981' }, // Emerald
  'Network Theory': { color: '#f59e0b' }, // Amber
};

export const DOMAIN_CLUSTERS: DomainCluster[] = Object.entries(DOMAINS).map(([name, data], i) => ({
  id: name,
  name,
  color: data.color,
  x: Math.cos((i / 5) * Math.PI * 2) * 800,
  y: Math.sin((i / 5) * Math.PI * 2) * 800,
}));

export function generateMockData(): { entities: Entity[], relationships: Relationship[] } {
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];
  
  let idCounter = 1;
  const generateId = () => `node_${idCounter++}`;

  // Generate Landmarks (Capitals)
  DOMAIN_CLUSTERS.forEach(cluster => {
    const landmarkId = generateId();
    entities.push({
      id: landmarkId,
      title: `${cluster.name} Core`,
      type: 'concept',
      domain: cluster.name,
      scale: 'landmark',
      description: `The foundational concepts and theories forming the basis of ${cluster.name}.`,
      tags: ['foundational', 'core'],
      x: cluster.x + (Math.random() - 0.5) * 100,
      y: cluster.y + (Math.random() - 0.5) * 100,
    });

    // Generate Cities (Major topics/methods)
    for (let i = 0; i < 5; i++) {
      const cityId = generateId();
      entities.push({
        id: cityId,
        title: `${cluster.name} Method ${i+1}`,
        type: 'methodology',
        domain: cluster.name,
        scale: 'city',
        description: `A significant methodology widely applied in ${cluster.name}.`,
        tags: ['method', 'applied'],
        x: cluster.x + (Math.random() - 0.5) * 400,
        y: cluster.y + (Math.random() - 0.5) * 400,
      });
      relationships.push({ source: cityId, target: landmarkId, type: 'builds_on', weight: 2 });

      // Generate Neighborhoods (Specific papers/tools)
      for (let j = 0; j < 10; j++) {
        const neighborhoodId = generateId();
        entities.push({
          id: neighborhoodId,
          title: `Paper ${cluster.name.charAt(0)}${i}${j}: ${Math.random().toString(36).substring(7)}`,
          type: 'paper',
          domain: cluster.name,
          scale: 'neighborhood',
          description: `Research exploring specific aspects of methodology ${i+1}.`,
          tags: ['research', 'literature'],
          x: cluster.x + (Math.random() - 0.5) * 600,
          y: cluster.y + (Math.random() - 0.5) * 600,
        });
        relationships.push({ source: neighborhoodId, target: cityId, type: 'references', weight: 1 });
        
        // Connect to random other neighborhood in same domain
        if (Math.random() > 0.7) {
            const others = entities.filter(e => e.scale === 'neighborhood' && e.domain === cluster.name && e.id !== neighborhoodId);
            if (others.length > 0) {
                const target = others[Math.floor(Math.random() * others.length)];
                relationships.push({ source: neighborhoodId, target: target.id, type: 'similar_to', weight: 1 });
            }
        }
      }
    }
  });

  // Cross-domain connections (Bridges / Highways)
  const landmarks = entities.filter(e => e.scale === 'landmark');
  for (let i = 0; i < landmarks.length; i++) {
    for (let j = i + 1; j < landmarks.length; j++) {
      if (Math.random() > 0.5) {
        relationships.push({
          source: landmarks[i].id,
          target: landmarks[j].id,
          type: 'intersects_with',
          weight: 3
        });
        
        // Add a "bridge" concept
        const bridgeId = generateId();
        entities.push({
            id: bridgeId,
            title: `Intersection of ${landmarks[i].domain} & ${landmarks[j].domain}`,
            type: 'concept',
            domain: landmarks[i].domain, // Pick one arbitrarily
            scale: 'city',
            tags: ['interdisciplinary'],
            x: (landmarks[i].x + landmarks[j].x) / 2,
            y: (landmarks[i].y + landmarks[j].y) / 2,
        });
        relationships.push({ source: bridgeId, target: landmarks[i].id, type: 'combines', weight: 2 });
        relationships.push({ source: bridgeId, target: landmarks[j].id, type: 'combines', weight: 2 });
      }
    }
  }

  // Run a static force layout to settle them nicely
  const simulation = d3.forceSimulation<Entity>(entities)
    .force('link', d3.forceLink(relationships).id((d: any) => d.id).distance(d => {
        if (d.weight === 3) return 800; // Landmarks far apart
        if (d.weight === 2) return 200; // Cities to Landmarks
        return 50; // Neighborhoods to Cities
    }))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('collide', d3.forceCollide().radius((d: any) => d.scale === 'landmark' ? 40 : d.scale === 'city' ? 20 : 10).iterations(2))
    .force('x', d3.forceX().x((d: any) => {
        const cluster = DOMAIN_CLUSTERS.find(c => c.name === d.domain);
        return cluster ? cluster.x : 0;
    }).strength(0.05))
    .force('y', d3.forceY().y((d: any) => {
        const cluster = DOMAIN_CLUSTERS.find(c => c.name === d.domain);
        return cluster ? cluster.y : 0;
    }).strength(0.05))
    .stop();

  // Fast-forward simulation
  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  // Assign fixed coordinates
  entities.forEach(e => {
    e.x = e.x || 0;
    e.y = e.y || 0;
  });

  return { entities, relationships };
}

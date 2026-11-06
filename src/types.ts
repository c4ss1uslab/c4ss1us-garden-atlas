export type EntityType = 
  | 'initiative' | 'organization' | 'company' | 'project' 
  | 'person' | 'concept' | 'topic' | 'framework' | 'methodology' 
  | 'model' | 'paper' | 'book' | 'report' | 'dataset' 
  | 'tool' | 'software' | 'website' | 'note' | 'event';

export type ScaleLevel = 'landmark' | 'city' | 'neighborhood' | 'street';

export interface Entity {
  id: string;
  title: string;
  type: EntityType;
  domain: string; 
  subdomain?: string;
  sub_idx?: number | null;
  scale: ScaleLevel;
  description?: string;
  content?: string;
  permalink?: string;
  stage?: string;
  relevance?: number;
  tags: string[];
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius?: number;
  file_path?: string | null;
  pinned?: number | null;
  is_new?: number | boolean;
}

export interface Relationship {
  id?: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  evidence?: string;
  visible?: boolean;
  is_soft?: boolean;
}

export function isSoftLink(rel: any): boolean {
  if (!rel) return false;
  if (rel.is_soft === true) return true;
  if (rel.visible === 'soft' || rel.visible === 'soft_link') return true;
  const ev = (rel.evidence || '').toLowerCase();
  if (ev.includes('[soft: true]') || ev.includes('[style: soft]') || ev.includes('[link_type: soft]')) {
    return true;
  }
  return false;
}

export interface DomainCluster {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

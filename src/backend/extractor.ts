import { GoogleGenAI, Type } from "@google/genai";
import { getEntities, insertPendingRelationship, insertEntity } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is required for LLM extraction.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

const RELATIONSHIP_TYPES = [
  'created_by', 'founded_by', 'works_at', 'inspired_by', 'builds_on', 
  'critiques', 'extends', 'references', 'cites', 'uses', 'related_to', 
  'similar_to', 'opposite_of', 'depends_on', 'member_of', 'part_of', 
  'influenced', 'collaborates_with', 'applied_in', 'discusses', 
  'studies', 'mentions', 'creates'
];

function resolveTargetEntity(targetTitle: string, allEntities: any[]) {
  const normTarget = targetTitle.toLowerCase().trim();
  // 1. Exact match
  let found = allEntities.find(e => e.title.toLowerCase().trim() === normTarget);
  if (found) return found;

  // 2. Substring match
  found = allEntities.find(e => {
    const normTitle = e.title.toLowerCase().trim();
    return normTarget.includes(normTitle) || normTitle.includes(normTarget);
  });
  if (found) return found;

  // 3. Slugified match
  const slugify = (s: string) => s.replace(/[^a-z0-9]+/g, '-').trim();
  const slugifiedTarget = slugify(normTarget);
  found = allEntities.find(e => slugify(e.title.toLowerCase()) === slugifiedTarget);
  return found;
}

function extractReferredTitles(content: string): string[] {
  const titles = new Set<string>();
  if (!content) return [];

  // Wiki-style links [[LinkName]] or [[LinkPath/LinkName|Alias]]
  const wikiRegex = /\[\[(.*?)\]\]/g;
  let match;
  while ((match = wikiRegex.exec(content)) !== null) {
    const parts = match[1].split('|');
    const targetPath = parts[0].trim();
    const targetName = targetPath.split('/').pop() || targetPath;
    if (targetName && targetName.trim()) {
      titles.add(targetName.trim());
    }
  }

  // Markdown links [text](link.md)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    const url = match[2];
    if (url && !url.startsWith('http')) {
      const parts = url.split('/');
      const targetFilename = parts[parts.length - 1].replace(/\.md$/, '').trim();
      if (targetFilename) {
        titles.add(targetFilename);
      }
    }
  }

  return Array.from(titles);
}

export async function extractRelationshipsForEntity(sourceId: string, modelName: string = "gemini-3.5-flash"): Promise<number> {
  const allEntities = getEntities();
  const sourceNode = allEntities.find(e => e.id === sourceId);
  if (!sourceNode) {
    throw new Error(`Source entity with ID ${sourceId} not found.`);
  }

  // Find referred titles/wikilinks in note content
  const referredTitles = extractReferredTitles(sourceNode.content || "");
  for (const title of referredTitles) {
    // Check if it already exists as an entity (case-insensitive)
    const exists = allEntities.some(e => e.title.toLowerCase().trim() === title.toLowerCase().trim());
    if (!exists) {
      console.log(`Dynamically provisioning stub entity for referred-to wikilink: "${title}"`);
      const stubId = uuidv4();
      const newStub = {
        id: stubId,
        title,
        type: 'stub',
        domain: 'Uncategorized',
        scale: 'street',
        description: 'Referred-to stub placeholder.',
        tags: ['stub'],
        content: '',
        permalink: '',
        stage: 'stub',
        relevance: 0
      };
      
      insertEntity(newStub);
      allEntities.push(newStub);
    }
  }

  // Filter out the source itself from targets
  const otherEntities = allEntities.filter(e => e.id !== sourceId);
  if (otherEntities.length === 0) return 0;

  const targetListStr = otherEntities.map(e => `- ${e.title} (${e.domain})`).join("\n");
  
  const systemInstruction = `You are an expert research ontology mapping assistant. 
Your task is to analyze the text content of a markdown note from a digital garden, and detect direct semantic connections FROM this source note TO other target notes listed in the provided "Valid Target Entities" list.

Each relationship MUST represent a single pairwise connection from the Source Note (the source of the relationship) to a single Target Note.

You MUST only choose target notes from the provided "Valid Target Entities" list. Do NOT invent any target titles or include external entities not in the list.

You MUST choose the relationship type strictly from this allowed list of types:
${RELATIONSHIP_TYPES.map(t => `- ${t}`).join("\n")}

The relationship type MUST represent how the Source Note relates to the Target Note (e.g. if the Source Note is a biography of Francis Miller, and Francis Miller is a researcher, the relationship from the biography to Francis Miller could be "mentions" or "references").

Provide the exact sentence or quote from the Source Note's content that serves as evidence for this pairwise relationship.`;

  const prompt = `
Valid Target Entities:
${targetListStr}

---
Source Note Title: ${sourceNode.title}
Source Note Domain: ${sourceNode.domain}
Source Note Tags: ${sourceNode.tags ? sourceNode.tags.join(", ") : ""}

Content:
${sourceNode.content || ""}
`;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        description: "List of identified relationships from the source note to other target notes.",
        items: {
          type: Type.OBJECT,
          properties: {
            targetTitle: { 
              type: Type.STRING, 
              description: "The exact or closest title of the target note from the list of valid target entities." 
            },
            relationshipType: { 
              type: Type.STRING, 
              description: "The relationship classification from the allowed types." 
            },
            evidence: { 
              type: Type.STRING, 
              description: "The specific sentence, quote, or phrase from the source note content that acts as evidence." 
            }
          },
          required: ["targetTitle", "relationshipType", "evidence"]
        }
      }
    }
  });

  const text = response.text || "[]";
  let relations: any[] = [];
  try {
    relations = JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Gemini output:", text, e);
    return 0;
  }

  let insertedCount = 0;
  for (const rel of relations) {
    const target = resolveTargetEntity(rel.targetTitle, otherEntities);
    if (target) {
      // Validate relationship type
      const type = RELATIONSHIP_TYPES.includes(rel.relationshipType) ? rel.relationshipType : "references";
      
      insertPendingRelationship({
        id: uuidv4(),
        source: sourceId,
        target: target.id,
        type,
        weight: 1,
        evidence: rel.evidence
      });
      insertedCount++;
    }
  }

  return insertedCount;
}

export async function extractRelationshipsForAllEntities(onProgress?: (current: number, total: number) => void): Promise<number> {
  const allEntities = getEntities();
  let totalInserted = 0;
  let index = 0;

  for (const entity of allEntities) {
    try {
      console.log(`Extracting relationships for entity (${index + 1}/${allEntities.length}): ${entity.title}`);
      const count = await extractRelationshipsForEntity(entity.id);
      totalInserted += count;
    } catch (e) {
      console.error(`Failed extraction for ${entity.title}:`, e);
    }
    index++;
    if (onProgress) {
      onProgress(index, allEntities.length);
    }
  }

  return totalInserted;
}

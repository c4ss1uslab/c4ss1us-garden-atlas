import ReactMarkdown from 'react-markdown';

const markdownContent = `
# Knowledge Atlas: System Architecture & Design

This document outlines the architecture, data model, and implementation roadmap for the Knowledge Atlas, designed to scale to thousands of nodes extracted from Markdown files.

## 1. Overall Architecture

The system transitions from a file-based mental model to a **Knowledge Platform** model. The architecture consists of three main tiers:

1. **Storage & Ingestion Layer**: The raw Markdown repository. A background process watches for changes, parsing files and extracting entities/relationships.
2. **Graph Engine & API (Backend)**: The parsed data is structured into a graph database (or specialized embedded DB) and served via API. It handles search, pathfinding, and layout generation.
3. **Atlas Visualization (Client)**: A WebGL/Canvas frontend that renders the graph as a geographic map (Continents, Cities, Roads) rather than a rigid node-link diagram.

## 2. Data Model

Entities and relationships are first-class citizens.

**Entity (Node)**
* \`id\`: UUID (or deterministic hash of source file path)
* \`type\`: e.g., \`Person\`, \`Concept\`, \`Project\`, \`Organization\`
* \`title\`, \`aliases\`, \`description\`
* \`domain\`: Primary field (determines "Continent")
* \`scale\`: Importance level (\`Landmark\`, \`City\`, \`Neighborhood\`, \`Street\`)
* \`tags\`: Array of strings
* \`metadata\`: Creation/Mod dates, custom YAML frontmatter
* \`x, y\`: Canonical coordinates (persistent spatial memory)

**Relationship (Edge)**
* \`source\`, \`target\`: Entity IDs
* \`type\`: e.g., \`builds_on\`, \`critiques\`, \`founded_by\`
* \`weight\`: Determines visibility at different zoom scales (e.g., Highway vs. Footpath)
* \`evidence\`: The markdown sentence/paragraph where the link was found

## 3. Graph Schema

The schema should enforce typed relationships for better semantic search. 

* \`(Person)-[:FOUNDED]->(Organization)\`
* \`(Concept)-[:BUILDS_ON]->(Concept)\`
* \`(Paper)-[:CITES]->(Paper)\`
* \`(Note)-[:MENTIONS]->(Any)\`

By typing the edges, we can apply specific visual rules (e.g., \`BUILDS_ON\` lines are thicker "highways", while \`MENTIONS\` are invisible until zoomed in).

## 4. Parsing Pipeline

A Node.js or Rust (e.g., using swc/markdown) worker pipeline:

1. **AST Generation**: Parse Markdown (including YAML frontmatter) using unified/remark.
2. **Metadata Extraction**: Read frontmatter for explicit types, tags, and domain.
3. **Link Resolution**: Convert \`[[WikiLinks]]\` or standard \`[links](...)\` into relationship edges.
4. **AI Enrichment (Optional)**: Run un-typed files through an LLM to auto-categorize (\`type\`), summarize (\`description\`), and extract implicit entities.
5. **Layout Pre-calculation**: Run a physics simulation (d3-force or igraph) periodically *on the backend* to determine stable \`x, y\` coordinates. Save these coordinates back to the graph database to maintain spatial memory.

## 5. Storage Strategy

For local/personal use, an embedded database is best to keep the stack simple:
* **DuckDB**: Excellent for fast analytical queries and filtering large flat tables.
* **SQLite + JSON**: Highly portable. We can store Nodes and Edges in separate tables, with JSON columns for flexible metadata.
* **Neo4j (Local)**: If deep pathfinding (e.g., "shortest path between Concept A and Person B") becomes a bottleneck.

*Recommendation*: Start with **SQLite**. It handles 100k+ nodes easily and requires zero infrastructure for a personal tool.

## 6. Visualization Strategy

The frontend uses an **Atlas Metaphor**:
* **Renderer**: Canvas API (or WebGL via PixiJS/Cosmograph) for performance. SVG is too slow for >5k nodes.
* **Semantic Zoom**: Just like Google Maps, we don't render everything at once. 
  * *World Zoom*: Show only "Continents" (domain blobs) and "Landmarks".
  * *Regional Zoom*: Reveal "Cities" and "Highways" (major edges).
  * *Street Zoom*: Reveal all notes, minor edges, and full text labels.
* **Topology**: Canonical positions. Once a node is placed, it stays there. Users learn its location.

## 7. Technology Stack

* **Frontend Framework**: React + Vite + TypeScript.
* **Styling**: Tailwind CSS.
* **State Management**: Zustand (for UI state and selected entities).
* **Renderer**: Custom HTML Canvas with \`d3-zoom\` for navigation and \`d3-force\` for initial layout processing. (If scaling past 50k nodes, migrate to Cosmograph or deck.gl).
* **Backend/Parser**: Node.js (or bundled within an Electron/Tauri app for a desktop experience) using SQLite (\`better-sqlite3\`).

## 8. Incremental Implementation Roadmap

* **Phase 1: The Core Atlas (Current Prototype)**
  * Define the data structures.
  * Build the Canvas renderer with Semantic Zoom.
  * Implement the sidebar and basic search.
* **Phase 2: The Ingestion Pipeline**
  * Write the Markdown parser (unified/remark).
  * Connect the parser output to a local SQLite database.
  * Serve the data to the frontend via a local API.
* **Phase 3: Stabilization & Editing**
  * Implement the backend force-layout step to calculate stable \`x,y\` coordinates.
  * Allow manual dragging/pinning of nodes in the UI to override layout.
* **Phase 4: AI & Advanced Graph Features**
  * LLM-assisted entity extraction from raw text.
  * Semantic search using local embeddings.
  * Shortest-path discovery and community detection.
`;

export default function DesignDocs() {
  return (
    <div className="w-full h-full bg-[#050608] text-slate-300 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-12 px-8 [&_h1]:text-white [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-6 [&_h1]:tracking-tighter [&_h2]:text-indigo-400 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-white [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-6 [&_h3]:mb-3 [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_li]:mb-1 [&_strong]:text-white [&_code]:text-amber-400 [&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm">
        <ReactMarkdown>{markdownContent}</ReactMarkdown>
      </div>
    </div>
  );
}

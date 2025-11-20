// data/fetch-uex-components.mjs
//
// Snapshot Star Citizen ship components from UEX API → SComponents.js
// This is meant to be run in GitHub Actions (Node 20).
//
// It will:
// 1) Fetch categories from UEX
// 2) Auto-detect "ship components" categories
// 3) Fetch items for those categories
// 4) Normalize to SComponents format
// 5) Write data/SComponents.js

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- CONFIG ---------------------------------------------------------

const API_BASE = "https://api.uexcorp.uk/2.0";

// If you later want to hardcode category IDs, set AUTO_DETECT_CATEGORIES=false
// and put the IDs in CATEGORY_IDS.
const AUTO_DETECT_CATEGORIES = true;

const CATEGORY_IDS = [
  // e.g. 101, 102
];

// Output file in /data
const OUTPUT_FILE = path.join(__dirname, "SComponents.js");

// ---- Helpers --------------------------------------------------------

function slugify(str = "") {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "cmp-" + Math.random().toString(36).slice(2, 8);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ---- Category fetching / detection ----------------------------------

function isComponentCategory(cat) {
  const section = (cat.section || "").toLowerCase();
  const name = (cat.name || "").toLowerCase();

  if (section.includes("ship components")) return true;

  const keywords = [
    "quantum",
    "shield",
    "power plant",
    "cooler",
    "computer",
    "radar",
    "jump",
    "scanner",
    "turret",
    "weapon",
    "missile",
    "mount",
    "rack"
  ];
  return keywords.some(k => name.includes(k));
}

async function getComponentCategoryIds() {
  if (!AUTO_DETECT_CATEGORIES && CATEGORY_IDS.length) {
    console.log("Using hardcoded category IDs:", CATEGORY_IDS);
    return CATEGORY_IDS;
  }

  const url = `${API_BASE}/categories?type=item`;
  console.log("Fetching categories:", url);
  const categories = await fetchJson(url);
  if (!Array.isArray(categories)) {
    throw new Error("Expected categories array, got: " + typeof categories);
  }

  const components = categories.filter(isComponentCategory);
  console.log("All categories:", categories.length);
  console.log("Detected component categories:");
  for (const c of components) {
    console.log(`  - id=${c.id} | section="${c.section}" | name="${c.name}"`);
  }

  const ids = components.map(c => c.id).filter(id => id != null);
  if (!ids.length) {
    throw new Error(
      "No component categories detected. Adjust isComponentCategory() or hardcode CATEGORY_IDS."
    );
  }
  return ids;
}

// ---- Mapping items -> SComponents -----------------------------------

function deriveType(item) {
  const section = (item.section || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  const combo = `${section} ${category} ${name}`;

  if (combo.includes("quantum")) return "Quantum Drive";
  if (combo.includes("shield")) return "Shield Generator";
  if (combo.includes("power plant")) return "Power Plant";
  if (combo.includes("cooler")) return "Cooler";
  if (combo.includes("computer")) return "Computer";
  if (combo.includes("radar")) return "Radar";
  if (combo.includes("jump")) return "Jump Module";
  if (combo.includes("scanner")) return "Scanner";
  if (combo.includes("turret")) return "Turret";
  if (combo.includes("missile") && combo.includes("rack")) return "Missile Rack";
  if (combo.includes("weapon") && combo.includes("mount")) return "Weapon Mount";

  if (item.category) return item.category;
  if (item.section) return item.section;
  return "Component";
}

function deriveClass(item) {
  const src = `${item.category || ""} ${item.section || ""}`.toLowerCase();
  if (src.includes("military")) return "Military";
  if (src.includes("civilian")) return "Civilian";
  if (src.includes("industrial")) return "Industrial";
  if (src.includes("stealth")) return "Stealth";
  if (src.includes("competition")) return "Competition";
  return null;
}

function normaliseSize(size) {
  if (!size) return null;
  const str = String(size).trim().toUpperCase();
  if (/^S\d+/.test(str)) return str;
  const num = str.replace(/[^\d]/g, "");
  return num ? `S${num}` : null;
}

function mapItemToComponent(item) {
  const uexId = item.id;
  const name = (item.name || "").trim();
  if (!name) return null;

  const type = deriveType(item);
  const size = normaliseSize(item.size);
  const cls = deriveClass(item);
  const manufacturer = item.company_name ? item.company_name.trim() : null;

  let notes = "";
  if (item.notification) {
    try {
      notes =
        typeof item.notification === "string"
          ? item.notification
          : JSON.stringify(item.notification);
    } catch {
      notes = "";
    }
  }

  return {
    id: "cmp-" + slugify(name),
    uexId,
    name,
    type,
    size,
    grade: null,           // UEX items endpoint doesn’t expose grade directly
    class: cls,
    manufacturer,
    whereToBuy: "",        // to be enriched later if you want
    notes,
    raw: item
  };
}

// ---- Main -----------------------------------------------------------

async function main() {
  console.log("=== UEX → SComponents snapshot ===");

  const categoryIds = await getComponentCategoryIds();
  console.log("Fetching items for category IDs:", categoryIds.join(", "));

  const allItems = [];
  for (const idCategory of categoryIds) {
    const url = `${API_BASE}/items?id_category=${idCategory}`;
    console.log("GET", url);
    const items = await fetchJson(url);
    if (!Array.isArray(items)) {
      console.warn(`Expected items array for id_category=${idCategory}, got`, typeof items);
      continue;
    }
    console.log(`  → ${items.length} items`);
    allItems.push(...items);
  }

  console.log(`Total raw items: ${allItems.length}`);

  const mapped = allItems.map(mapItemToComponent).filter(Boolean);

  const dedup = new Map();
  for (const c of mapped) {
    const key = `${c.type}::${c.name}`.toLowerCase();
    if (!dedup.has(key)) dedup.set(key, c);
  }

  const finalList = Array.from(dedup.values()).sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
  );

  console.log(`Final normalized components: ${finalList.length}`);

  const header =
    "// Auto-generated from UEX items API\n" +
    "// Do not edit manually. Run fetch-uex-components.mjs instead.\n\n";

  const body =
    "export const SComponents = " +
    JSON.stringify(finalList, null, 2) +
    ";\n";

  await fs.writeFile(OUTPUT_FILE, header + body, "utf8");
  console.log("Written:", OUTPUT_FILE);
}

main().catch(err => {
  console.error("ERROR in fetch-uex-components.mjs");
  console.error(err);
  process.exit(1);
});

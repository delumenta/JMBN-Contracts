// data/fetch-uex-components.mjs
//
// Snapshot Star Citizen ship components from UEX API → SComponents.js
// Designed for GitHub Actions (Node 20+)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = "https://api.uexcorp.uk/2.0";
const OUTPUT_FILE = path.join(__dirname, "SComponents.js");

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function slugify(str = "") {
  return (
    String(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "cmp-" + Math.random().toString(36).slice(2, 8)
  );
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function unwrap(res) {
  return Array.isArray(res) ? res : res.data || [];
}

// -----------------------------------------------------------------------------
// CATEGORY DETECTION
// -----------------------------------------------------------------------------

function looksLikeComponentCategory(cat) {
  const name = (cat.name || "").toLowerCase();
  const sec = (cat.section || "").toLowerCase();

  if (sec.includes("ship components")) return true;

  const keywords = [
    "quantum",
    "shield",
    "power plant",
    "cooler",
    "jump",
    "computer",
    "radar",
    "weapon",
    "mount",
    "rack",
    "scanner",
    "missile",
    "turret"
  ];

  return keywords.some((k) => name.includes(k));
}

async function getComponentCategoryIds() {
  const url = `${API_BASE}/categories?type=item`;
  const raw = await fetchJson(url);
  const categories = unwrap(raw);

  const comps = categories.filter(looksLikeComponentCategory);
  return comps.map((c) => c.id);
}

// -----------------------------------------------------------------------------
// TYPE / CLASS / SIZE MAPPERS
// -----------------------------------------------------------------------------

function normaliseType(item) {
  const full = `${item.section || ""} ${item.category || ""} ${item.name || ""}`.toLowerCase();

  if (full.includes("quantum")) return "Quantum Drive";
  if (full.includes("shield")) return "Shield Generator";
  if (full.includes("power plant")) return "Power Plant";
  if (full.includes("cooler")) return "Cooler";
  if (full.includes("jump")) return "Jump Module";
  if (full.includes("computer")) return "Computer";
  if (full.includes("radar")) return "Radar";
  if (full.includes("scanner")) return "Scanner";
  if (full.includes("turret")) return "Turret";
  if (full.includes("weapon") && full.includes("mount")) return "Weapon Mount";
  if (full.includes("missile") && full.includes("rack")) return "Missile Rack";

  return item.category || item.section || "Component";
}

function normaliseClass(item) {
  const test = `${item.category || ""} ${item.section || ""}`.toLowerCase();
  if (test.includes("military")) return "Military";
  if (test.includes("civilian")) return "Civilian";
  if (test.includes("industrial")) return "Industrial";
  if (test.includes("stealth")) return "Stealth";
  if (test.includes("competition")) return "Competition";
  return null;
}

function normaliseSize(size) {
  if (!size) return null;
  const s = String(size).toUpperCase().trim();
  if (/^S\d+/.test(s)) return s;
  const n = s.replace(/[^\d]/g, "");
  return n ? `S${n}` : null;
}

// -----------------------------------------------------------------------------
// SHOPS (WHERE TO BUY)
// -----------------------------------------------------------------------------

async function fetchShopsForItem(itemId) {
  const url = `${API_BASE}/items_prices?id_item=${itemId}`;
  const raw = await fetchJson(url);
  const records = unwrap(raw);

  const shops = [];

  for (const rec of records) {
    if (!rec.store || !rec.store.location) continue;
    const store = rec.store.location;

    shops.push(
      `${store.planet || ""} ${store.city || ""} ${store.base || ""}`
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  return Array.from(new Set(shops)).filter(Boolean);
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------

async function main() {
  console.log("=== Fetching UEX Components ===");

  // Step 1: Find all relevant categories
  const categoryIds = await getComponentCategoryIds();

  const allItems = [];

  // Step 2: Fetch all items in each category
  for (const id of categoryIds) {
    const url = `${API_BASE}/items?id_category=${id}`;
    const raw = await fetchJson(url);
    const items = unwrap(raw);
    allItems.push(...items);
  }

  // Step 3: Map items → SComponents format
  const mapped = [];

  for (const item of allItems) {
    const comp = {
      id: "cmp-" + slugify(item.name),
      uexId: item.id,
      name: item.name,
      type: normaliseType(item),
      size: normaliseSize(item.size),
      grade: null,
      class: normaliseClass(item),
      manufacturer: item.company_name || null,
      whereToBuy: [],
      notes: "",
      raw: item
    };

    // Step 4: Fetch shop data / where to buy
    const shops = await fetchShopsForItem(item.id);
    comp.whereToBuy = shops;

    mapped.push(comp);
  }

  // Step 5: Dedupe + sort
  const unique = new Map();
  for (const c of mapped) {
    const key = `${c.type}::${c.name}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, c);
  }

  const finalList = Array.from(unique.values()).sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
  );

  // Step 6: Write file
  const header =
    "// Auto-generated from UEX API\n" +
    "// Do not edit manually. Run fetch-uex-components.mjs instead.\n\n";

  const body =
    "export const SComponents = " +
    JSON.stringify(finalList, null, 2) +
    ";\n";

  await fs.writeFile(OUTPUT_FILE, header + body, "utf8");

  console.log("✓ Wrote:", OUTPUT_FILE);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
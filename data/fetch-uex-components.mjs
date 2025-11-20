// data/fetch-uex-components.mjs
// UEX (items + prices) + scunpacked (ship-items.json)
// → data/SComponents.js
//
// Requires:
//   - env UEX_API_KEY set to your UEX bearer token
//
// NOTE:
//   - Class / Grade come from scunpacked.
//   - Where-to-buy comes from UEX item_prices_all.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === CONFIG =================================================================

const UEX_BASE = "https://api.uexcorp.uk/2.0";
const UEX_TOKEN = process.env.UEX_API_KEY || "";

// use your fork (works the same as the official repo)
const SCUNPACKED_URL =
  "https://raw.githubusercontent.com/delumenta/scunpacked-data/refs/heads/master/ship-items.json";

// === GENERIC HELPERS ========================================================

if (!UEX_TOKEN) {
  console.error("ERROR: UEX_API_KEY environment variable is not set.");
  process.exit(1);
}

/**
 * Simple fetch with JSON + error handling.
 */
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Accept: "application/json",
      Authorization: `Bearer ${UEX_TOKEN}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${url} – ${text.slice(0, 500)}`
    );
  }

  return res.json();
}

/**
 * Call UEX and return .data array.
 */
async function fetchUex(resource, params = {}) {
  const url = new URL(`${UEX_BASE}/${resource}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }

  const json = await fetchJson(url.toString(), {
    // headers added in fetchJson
  });

  if (json.status !== "ok") {
    throw new Error(
      `UEX error for ${resource}: ${json.status || json.message || "unknown"}`
    );
  }
  return json.data || [];
}

// basic string normaliser for matching names
function norm(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Deep search for a key like "Class" or "Grade".
function deepFindKey(obj, keyLower, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return undefined;

  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === keyLower) {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        return v;
      }
    }
    if (typeof v === "object") {
      const nested = deepFindKey(v, keyLower, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

// Normalise class value from arbitrary string
function normaliseClass(raw) {
  if (!raw && raw !== 0) return "";
  const s = String(raw).toLowerCase();

  const known = [
    "military",
    "civilian",
    "industrial",
    "stealth",
    "competition",
    "performance",
    "racing",
  ];

  for (const k of known) {
    if (s.includes(k)) {
      // Capitalise first letter
      return k.charAt(0).toUpperCase() + k.slice(1);
    }
  }
  return "";
}

// Normalise grade value from arbitrary string
function normaliseGrade(raw) {
  if (!raw && raw !== 0) return "";
  const s = String(raw).trim();

  // Pure letter grade?
  if (/^[A-D]$/i.test(s)) return s.toUpperCase();

  // e.g. "Grade A", "ItemGrade_B"
  const match = s.match(/[A-D]/i);
  if (match) return match[0].toUpperCase();

  return "";
}

// === DOMAIN HELPERS =========================================================

/**
 * Map UEX category → our component type.
 */
function normaliseComponentType({ section, category, name }) {
  const sec = (section || "").toLowerCase();
  const cat = (category || "").toLowerCase();
  const nm = (name || "").toLowerCase();

  if (cat.includes("quantum")) return "Quantum Drive";
  if (cat.includes("jump drive")) return "Jump Drive";
  if (cat.includes("shield")) return "Shield Generator";
  if (cat.includes("power plant")) return "Power Plant";
  if (cat.includes("cooler")) return "Cooler";
  if (cat.includes("computer") || sec.includes("computer")) return "Computer";
  if (cat.includes("radar")) return "Radar";
  if (cat.includes("missile")) return "Missile Rack";
  if (cat.includes("weapon mount") || nm.includes("weapon mount"))
    return "Weapon Mount";

  return category || "Component";
}

/**
 * Build a nice Where-to-buy string from price rows.
 */
function buildWhereToBuy(rows) {
  if (!rows || !rows.length) return "";
  const names = [
    ...new Set(rows.map((r) => r.terminal_name).filter((x) => !!x)),
  ];
  return names.sort().join("; ");
}

// === SCUNPACKED MERGE =======================================================

/**
 * Try to get a usable display name from a scunpacked entry.
 * ship-items.json structure can change between versions, so we are defensive.
 */
function getScName(sc) {
  // 1. Plain "name"
  if (typeof sc.name === "string" && sc.name.trim()) return sc.name.trim();

  // 2. name as localised object, e.g. { en_US: "TS-2", de_DE: "TS-2" }
  if (sc.name && typeof sc.name === "object") {
    const cand =
      sc.name.en_US ||
      sc.name.en_us ||
      sc.name.en ||
      sc.name["en-EN"] ||
      Object.values(sc.name)[0];
    if (typeof cand === "string" && cand.trim()) return cand.trim();
  }

  // 3. label/localised/display
  const altKeys = ["label", "display", "localized", "localised", "itemName"];
  for (const key of altKeys) {
    const v = sc[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const cand =
        v.en_US || v.en_us || v.en || v["en-EN"] || Object.values(v)[0];
      if (typeof cand === "string" && cand.trim()) return cand.trim();
    }
  }

  // 4. Fall back to className or item
  if (typeof sc.className === "string" && sc.className.trim())
    return sc.className.trim();
  if (typeof sc.item === "string" && sc.item.trim()) return sc.item.trim();

  return "";
}

/**
 * Extract class + grade from a scunpacked entry using heuristics.
 */
function getScClassGrade(sc) {
  // Try shallow fields first
  const directClass =
    sc.class || sc.itemClass || sc.componentClass || sc.typeClass;
  const directGrade = sc.grade || sc.itemGrade || sc.componentGrade;

  let cls = normaliseClass(directClass);
  let grd = normaliseGrade(directGrade);

  // If still empty, try deep search
  if (!cls) {
    const deepClass = deepFindKey(sc, "class");
    cls = normaliseClass(deepClass);
  }
  if (!grd) {
    const deepGrade = deepFindKey(sc, "grade");
    grd = normaliseGrade(deepGrade);
  }

  // As a last resort, check tags for "Military", "Grade A", etc.
  if (Array.isArray(sc.tags)) {
    for (const tag of sc.tags) {
      if (!cls) cls = normaliseClass(tag);
      if (!grd) grd = normaliseGrade(tag);
    }
  }

  return { cls, grd };
}

/**
 * Load scunpacked ship-items and build a name → entry map.
 */
async function loadScunpackedIndex() {
  console.log(`Fetching scunpacked index: ${SCUNPACKED_URL}`);
  const res = await fetch(SCUNPACKED_URL);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for scunpacked – ${text.slice(
        0,
        300
      )}`
    );
  }
  const json = await res.json();

  const arr = Array.isArray(json) ? json : json.data || json.items || [];
  if (!Array.isArray(arr)) {
    throw new Error(
      "Unexpected scunpacked ship-items.json format (not an array)."
    );
  }

  const map = new Map();
  let namedCount = 0;

  for (const sc of arr) {
    const name = getScName(sc);
    if (!name) continue;
    const key = norm(name);
    if (!key) continue;

    // Prefer first occurrence, but you can change this to override duplicates
    if (!map.has(key)) {
      map.set(key, sc);
    }
    namedCount++;
  }

  console.log(
    `scunpacked: ${arr.length} raw entries, ${namedCount} with usable names, ${map.size} unique name keys`
  );

  // Log one sample entry for debugging
  const sample = arr[0];
  if (sample) {
    console.log(
      "scunpacked sample keys:",
      Object.keys(sample).slice(0, 20).join(", ")
    );
  }

  return map;
}

// === MAIN ===================================================================

async function main() {
  console.log("=== UEX + scunpacked → SComponents snapshot ===");

  // ---- 1. UEX categories ---------------------------------------------------
  console.log("Fetching UEX categories (type=item) …");
  const allCategories = await fetchUex("categories", { type: "item" });

  const interestingCategories = allCategories.filter((c) => {
    const sec = (c.section || "").toLowerCase();
    const nm = (c.name || "").toLowerCase();

    const isShipComponent = sec.includes("ship");
    const keywordMatch = /quantum|shield|power plant|cooler|computer|radar|weapon|missile/.test(
      nm
    );

    return c.type === "item" && (isShipComponent || keywordMatch);
  });

  console.log(
    "Using categories:",
    interestingCategories.map((c) => `${c.id}:${c.name}`).join(", ")
  );

  // ---- 2. UEX items for those categories ----------------------------------
  const itemsById = new Map();

  for (const cat of interestingCategories) {
    console.log(`Fetching UEX items for category ${cat.id} (${cat.name}) …`);
    const list = await fetchUex("items", { id_category: cat.id });

    for (const it of list) {
      itemsById.set(it.id, { ...it, _category: cat.name, _section: cat.section });
    }
  }

  const uexItems = Array.from(itemsById.values());
  console.log(`Total unique UEX items: ${uexItems.length}`);

  // ---- 3. UEX prices / terminals (where to buy) ---------------------------
  console.log("Fetching UEX items_prices_all …");
  const allPrices = await fetchUex("items_prices_all");

  const idSet = new Set(uexItems.map((i) => i.id));
  const priceRows = allPrices.filter((p) => idSet.has(p.id_item));

  const pricesByItemId = new Map();
  for (const row of priceRows) {
    if (!pricesByItemId.has(row.id_item))
      pricesByItemId.set(row.id_item, []);
    pricesByItemId.get(row.id_item).push(row);
  }

  console.log(
    `Matched ${pricesByItemId.size} UEX items with at least one terminal row`
  );

  // ---- 4. scunpacked merge index ------------------------------------------
  const scIndex = await loadScunpackedIndex();

  // ---- 5. Build final components array ------------------------------------
  let matched = 0;
  let unmatched = 0;

  const components = uexItems.map((item) => {
    const locRows = pricesByItemId.get(item.id) || [];
    const whereToBuy = buildWhereToBuy(locRows);

    const type = normaliseComponentType({
      section: item.section || item._section,
      category: item.category || item._category,
      name: item.name,
    });

    // Try to find scunpacked entry by normalised name
    const nameKey = norm(item.name);
    const sc = nameKey ? scIndex.get(nameKey) : undefined;

    let scClass = "";
    let scGrade = "";

    if (sc) {
      const { cls, grd } = getScClassGrade(sc);
      scClass = cls;
      scGrade = grd;
      if (cls || grd) matched++;
      else unmatched++;
    } else {
      unmatched++;
    }

    return {
      id: item.id,
      name: item.name,
      type,
      size: item.size || "",
      grade: scGrade || "",
      class: scClass || "",
      manufacturer: item.company_name || "",
      section: item.section || item._section || "",
      category: item.category || item._category || "",
      game_version: item.game_version || "",
      buy: whereToBuy,
      // references
      uex: {
        id_item: item.id,
        id_category: item.id_category,
        slug: item.slug,
        uuid: item.uuid,
      },
      sc: sc
        ? {
            // keep a few useful fields for debugging or future stats merge
            name: getScName(sc),
            className: sc.className || null,
            type: sc.type || null,
          }
        : null,
    };
  });

  console.log(
    `Merge stats: ${matched} items had class/grade from scunpacked, ${unmatched} without.`
  );

  // ---- 6. Write data/SComponents.js ---------------------------------------
  const outPath = path.join(__dirname, "SComponents.js");
  const header = `// data/SComponents.js
// AUTO-GENERATED by fetch-uex-components.mjs
// Sources:
//   - UEX API (categories, items, items_prices_all)
//   - scunpacked ship-items.json (class, grade heuristics)
//
// Do NOT edit this file manually.

`;

  const body =
    "export const SComponents = " +
    JSON.stringify(components, null, 2) +
    ";\n";

  await fs.writeFile(outPath, header + body, "utf8");
  console.log(
    `Wrote ${components.length} merged components to ${outPath}`
  );
}

main().catch((err) => {
  console.error("ERROR in fetch-uex-components.mjs");
  console.error(err);
  process.exit(1);
});

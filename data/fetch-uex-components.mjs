// data/fetch-uex-components.mjs
// Fetch Star Citizen components from UEX + where-to-buy info
// and generate data/SComponents.js for your Components page.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = "https://api.uexcorp.uk/2.0";
const TOKEN = process.env.UEX_API_KEY || "";

// ---- helpers --------------------------------------------------------------

if (!TOKEN) {
  console.error("ERROR: UEX_API_KEY environment variable is not set.");
  process.exit(1);
}

/**
 * Call UEX API and return the .data array.
 */
async function fetchUEX(resource, params = {}) {
  const url = new URL(`${API_BASE}/${resource}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${url.toString()} – ${text}`
    );
  }

  const json = await res.json();
  if (json.status !== "ok") {
    throw new Error(
      `UEX error for ${resource}: ${json.status || json.message || "unknown"}`
    );
  }
  return json.data || [];
}

/**
 * Normalise an item into a JMBN "component type"
 * based on its category / section / name.
 */
function normaliseType(item) {
  const section = (item.section || "").toLowerCase();
  const cat = (item.category || "").toLowerCase();
  const name = (item.name || "").toLowerCase();

  if (cat.includes("quantum")) return "Quantum Drive";
  if (cat.includes("jump drive")) return "Jump Drive";
  if (cat.includes("shield")) return "Shield Generator";
  if (cat.includes("power plant")) return "Power Plant";
  if (cat.includes("cooler")) return "Cooler";
  if (cat.includes("computer") || section.includes("computer")) return "Computer";
  if (cat.includes("radar")) return "Radar";
  if (cat.includes("missile")) return "Missile Rack";
  if (cat.includes("weapon mount") || name.includes("weapon mount"))
    return "Weapon Mount";

  return item.category || "Component";
}

/**
 * Build a nice "Where to Buy" label from terminal rows.
 */
function buildWhereToBuy(rows) {
  if (!rows.length) return "";
  const names = [...new Set(rows.map((r) => r.terminal_name).filter(Boolean))];
  return names.sort().join("; ");
}

// ---- main logic -----------------------------------------------------------

async function main() {
  console.log("=== UEX → SComponents snapshot ===");

  // 1. Get item categories, filtered to items (not services/contracts)
  console.log("Fetching categories…");
  const allCategories = await fetchUEX("categories", { type: "item" });

  // We only care about ship components / similar things.
  const interestingCategories = allCategories.filter((c) => {
    const section = (c.section || "").toLowerCase();
    const name = (c.name || "").toLowerCase();

    const isShipComponent = section.includes("ship");
    const keywordMatch = /quantum|shield|power plant|cooler|computer|radar|weapon|missile/.test(
      name
    );

    return c.type === "item" && (isShipComponent || keywordMatch);
  });

  if (!interestingCategories.length) {
    console.warn("WARNING: No interesting categories found – check filters.");
  } else {
    console.log(
      "Using categories:",
      interestingCategories.map((c) => `${c.id}:${c.name}`).join(", ")
    );
  }

  // 2. Fetch items for those categories
  const items = [];
  const itemsById = new Map();

  for (const cat of interestingCategories) {
    console.log(`Fetching items for category ${cat.id} (${cat.name})…`);
    const catItems = await fetchUEX("items", { id_category: cat.id });

    for (const it of catItems) {
      // ensure we keep the latest version if duplicates appear
      itemsById.set(it.id, { ...it, _category: cat.name, _section: cat.section });
    }
  }

  const mergedItems = Array.from(itemsById.values());
  console.log(`Total unique items fetched: ${mergedItems.length}`);

  // 3. Fetch all prices for all items (single big call)
  console.log("Fetching items_prices_all…");
  const allPrices = await fetchUEX("items_prices_all");

  // Keep only prices that correspond to the items we care about
  const idSet = new Set(mergedItems.map((i) => i.id));
  const priceRows = allPrices.filter((p) => idSet.has(p.id_item));

  console.log(`Matched price rows for ${priceRows.length} terminal entries.`);

  // Group price rows by item ID
  const pricesByItemId = new Map();
  for (const row of priceRows) {
    if (!pricesByItemId.has(row.id_item)) pricesByItemId.set(row.id_item, []);
    pricesByItemId.get(row.id_item).push(row);
  }

  // 4. Build final SComponents array
  const components = mergedItems.map((item) => {
    const locRows = pricesByItemId.get(item.id) || [];

    const whereToBuy = buildWhereToBuy(locRows);

    return {
      // Core identity
      id: item.id,
      name: item.name,
      type: normaliseType(item),

      // From UEX item data
      size: item.size || "",
      grade: "", // UEX doesn't expose grade directly; can be filled from another source
      class: "", // same as above
      manufacturer: item.company_name || "",
      section: item.section || item._section || "",
      category: item.category || item._category || "",
      game_version: item.game_version || "",

      // Where to buy (for Components page)
      buy: whereToBuy,

      // Raw UEX references (handy if you want to debug / join later)
      uex: {
        id_item: item.id,
        id_category: item.id_category,
        slug: item.slug,
        uuid: item.uuid,
      },
    };
  });

  // 5. Write data/SComponents.js
  const outPath = path.join(__dirname, "SComponents.js");
  const header = `// data/SComponents.js
// AUTO-GENERATED by fetch-uex-components.mjs
// Do NOT edit by hand.
// Source: UEX API (items + items_prices_all)

`;

  const body =
    "export const SComponents = " +
    JSON.stringify(components, null, 2) +
    ";\n";

  await fs.writeFile(outPath, header + body, "utf8");
  console.log(`Wrote ${components.length} components to ${outPath}`);
}

main().catch((err) => {
  console.error("ERROR in fetch-uex-components.mjs");
  console.error(err);
  process.exit(1);
});

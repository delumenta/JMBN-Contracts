import fs from "fs/promises";

const API_KEY = "274c40ae7092f345a04016a93fb6bb4b61cbdac5";  // <- replace locally, never commit

const BASE = "https://uexcorp.space/api";

async function fetchAllItems() {
  let page = 1;
  const limit = 100;        // or whatever UEX supports
  let all = [];

  while (true) {
    const url = `${BASE}/items?page=${page}&limit=${limit}`;
    console.log("Fetching", url);

    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      console.error("HTTP error", res.status, await res.text());
      break;
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.log("No more items, stopping at page", page);
      break;
    }

    all = all.concat(data);
    page++;
  }

  return all;
}

// crude filter: keep only items where category/subcategory suggests "component"
function filterComponents(items) {
  return items.filter(it => {
    const c  = (it.category    || "").toLowerCase();
    const sc = (it.subcategory || "").toLowerCase();
    const n  = (it.name        || "").toLowerCase();

    return (
      c.includes("component") ||
      c.includes("ship") ||
      sc.includes("quantum") ||
      sc.includes("shield") ||
      sc.includes("power plant") ||
      sc.includes("cooler") ||
      sc.includes("computer") ||
      sc.includes("radar") ||
      n.includes("quantum drive") ||
      n.includes("shield")
    );
  });
}

// map into your JMBN shape
function mapToJmbn(items) {
  return items.map(it => {
    // you’ll need to adapt these based on real field names from UEX
    return {
      id:        it.id,
      name:      it.name || "",
      type:      it.subcategory || it.category || "",
      size:      (it.size || "").replace(/\s+/g,""),      // "S  2" -> "S2"
      grade:     it.grade ? `Grade ${it.grade}` : "",
      class:     it.class || "",
      manufacturer: it.manufacturer || it.mfr || "",
      buy:       "",     // you can later fill from marketplace endpoints if you want
      notes:     ""
    };
  });
}

(async () => {
  const all = await fetchAllItems();
  console.log("Total items:", all.length);

  const comps = filterComponents(all);
  console.log("Filtered components:", comps.length);

  const jmbn = mapToJmbn(comps);

  // write to components.js as plain JSON array
  await fs.writeFile("./data/components.js", JSON.stringify(jmbn, null, 2), "utf8");
  console.log("Written ./data/components.js");
})();

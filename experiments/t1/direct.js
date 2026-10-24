const PROMPT = `You produce a complete geography map directly from a worldbuilding description. Use coordinates 0..1 (x east, y south). Output exactly one JSON object, no Markdown, with fields:
{"extent_km":1024,"land":[[[0,0],[1,0],[1,1],[0,1]]],"lakes":[{"name":"","area":[[0.4,0.4],[0.5,0.4],[0.5,0.5]]}],"mountains":[{"name":"Range","area":[[0.2,0.2],[0.4,0.2],[0.3,0.4]]}],"biomes":[{"type":"desert","area":[[0,0],[0.2,0],[0.2,0.2]]}],"rivers":[{"name":"River","points":[[0.3,0.3],[0.5,0.5],[0.7,0.8]]}],"settlements":[{"name":"Town","type":"town","x":0.5,"y":0.5}],"unmet":[]}
extent_km must be 1024, 2048 or 4096. land is a list of mainland/island polygons; outside them is sea. An inland world needs a polygon covering the full map. area is a polygon of 3+ points; river points are a source-to-mouth line of 2+ points. biome type: desert, grassland, forest, marsh, tundra, ice, rock. Settlement type: port, city, town, village, fortress.
Geographic rules: rivers run from high ground to sea, lake, or the map edge; they never stop mid-land. Rivers merge but never split. A lake has at most one outlet. Ports lie on the sea; a river-mouth port sits where the river reaches sea. An inland or no-sea description must have no sea. The leeward side of mountains is drier.
Draw every place named in 「」 exactly, preserving its name and type. You may add a few plausible places as the planner does. If any requirement is impossible, record it and the reason in unmet rather than quietly changing it. Give enough polygon and river detail to show the layout. Think through the entire description before producing valid JSON.`;
function validateDirect(raw) {
  if (!raw || ![1024, 2048, 4096].includes(raw.extent_km)) throw new Error('G0 invalid extent_km');
  for (const k of ['land', 'lakes', 'mountains', 'biomes', 'rivers', 'settlements', 'unmet']) if (!Array.isArray(raw[k])) throw new Error(`G0 missing ${k}`);
  return raw;
}
async function directMap(client, description) { return validateDirect(await client.json(`${PROMPT}\n\nDescription:\n"""${description.slice(0, 3000)}"""`, 'direct_map', { max_tokens: 12000 })); }
module.exports = { PROMPT, validateDirect, directMap };

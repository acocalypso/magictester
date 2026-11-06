// Alternate printed names refer to the same Oracle card, not a different deck slot.
export async function flavorAliases(get) {
  const aliases = {},
    seen = new Set();
  let url =
    "https://api.scryfall.com/cards/search?q=has%3Aflavorname&unique=prints";
  while (url) {
    const target = new URL(url);
    if (
      target.origin !== "https://api.scryfall.com" ||
      target.pathname !== "/cards/search" ||
      seen.has(url) ||
      seen.size >= 30
    )
      throw Error("Unexpected Scryfall alias pagination");
    seen.add(url);
    const result = await get(url);
    if (result.object !== "list" || !Array.isArray(result.data))
      throw Error("Invalid Scryfall alias response");
    for (const card of result.data) {
      if (
        typeof card.flavor_name !== "string" ||
        typeof card.name !== "string" ||
        !card.flavor_name.trim()
      )
        continue;
      if (aliases[card.flavor_name] && aliases[card.flavor_name] !== card.name)
        throw Error("Ambiguous printed card alias: " + card.flavor_name);
      aliases[card.flavor_name] = card.name;
    }
    url = result.has_more ? result.next_page : null;
    if (result.has_more && !url)
      throw Error("Incomplete Scryfall alias pagination");
  }
  return aliases;
}

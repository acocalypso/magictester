import { getFormat } from "./formats.js";
import { validateDeck, type CardDataProvider } from "./domain.js";
const red = [
  "Lightning Bolt",
  "Chain Lightning",
  "Lava Spike",
  "Rift Bolt",
  "Shock",
  "Incinerate",
  "Lightning Strike",
  "Searing Blaze",
  "Thermo-Alchemist",
  "Kessig Flamebreather",
  "Burst Lightning",
  "Monastery Swiftspear",
  "Soul-Scar Mage",
  "Play with Fire",
  "Skewer the Critics",
  "Wizard's Lightning",
  "Fanatical Firebrand",
  "Goblin Guide",
  "Goblin Instigator",
  "Dragon Fodder",
  "Abrade",
  "Scorching Dragonfire",
  "Fireball",
  "Goblin Negotiation",
  "Screaming Nemesis",
  "Heartfire Hero",
  "Emberheart Challenger",
  "Manifold Mouse",
  "Monstrous Rage",
  "Hired Claw",
  "Ghitu Lavarunner",
  "Viashino Pyromancer",
  "Firebrand Archer",
];
const green = [
  "Llanowar Elves",
  "Elvish Mystic",
  "Nest Invader",
  "Nettle Sentinel",
  "Quirion Ranger",
  "Rancor",
  "Vines of Vastwood",
  "Hunger of the Howlpack",
  "Savage Swipe",
  "River Boa",
  "Giant Growth",
  "Elvish Visionary",
  "Dwynen's Elite",
  "Llanowar Loamspeaker",
  "Scavenging Ooze",
  "Snakeskin Veil",
  "Bite Down",
  "Prey Upon",
  "Colossal Dreadmaw",
  "Elvish Archdruid",
  "Bushwhack",
  "Mossborn Hydra",
  "Imperious Perfect",
  "Tyvar's Stand",
  "Pawpatch Recruit",
  "Bristly Bill, Spine Sower",
  "Flourishing Bloom-Kin",
  "Botanical Brawler",
  "Sentinel of the Nameless City",
  "Questing Beast",
  "Old-Growth Troll",
  "Steel Leaf Champion",
  "Grizzly Bears",
];
export function referencePool(format: string, provider: CardDataProvider) {
  const definition = getFormat(format);
  if (!definition?.enabled)
    throw new Error("Reference pool is not available for this format");
  if (definition.commander) {
    const decks = ["Bruvac the Grandiloquent", "Ambassador Laquatus"].map(
      (commander, index) => {
        const decklist = `40 Island\n59 Persistent Petitioners\nCommander\n1 ${commander}`;
        const validation = validateDeck(decklist, format, provider);
        if (!validation.valid)
          throw new Error(
            "Commander reference failed validation: " +
              JSON.stringify(validation.errors),
          );
        return {
          name: index === 0 ? "Bruvac reference" : "Laquatus reference",
          archetype:
            index === 0 ? "Bruvac mill reference" : "Laquatus mill reference",
          strategy: "CONTROL" as const,
          decklist,
          sourceUrl: null,
          metaShare: null,
        };
      },
    );
    return {
      name: `${definition.name} · Local reference pool`,
      format: definition.id,
      source: `Project-authored ${definition.name} integration lists, not tournament data or a current competitive field. ${definition.players === 4 ? "Small pools repeat lists across opponent seats." : ""}`,
      selectionMethod: "custom_pool" as const,
      decks,
    };
  }
  const deck = (land: string, candidates: string[], name: string) => {
    const chosen = candidates
      .filter((n) => {
        const card = provider.find(n);
        return (
          card &&
          card.legalities[definition.legalityKey] === "legal" &&
          provider.supports(card.name)
        );
      })
      .slice(0, 10);
    // These are explicitly reference lists, not tournament recommendations. Keep 60 cards,
    // even if a future rotation removes some of the candidate spells.
    const spellCount = Math.min(10, chosen.length);
    const list = [
      `${60 - spellCount * 4} ${land}`,
      ...chosen.map((n) => "4 " + provider.find(n)!.name),
    ].join("\n");
    const result = validateDeck(list, format, provider);
    if (!result.valid)
      throw new Error(
        "Reference deck failed validation: " + JSON.stringify(result.errors),
      );
    return {
      name,
      archetype: name,
      strategy: "AGGRO" as const,
      decklist: list,
      sourceUrl: null,
      metaShare: null,
    };
  };
  return {
    name: `${definition.name} · Local reference pool`,
    format: definition.id,
    source:
      "Project-authored reference lists for integration testing and fixed-pool comparisons. Not tournament data or a current metagame.",
    selectionMethod: "equal_archetype" as const,
    decks: [
      deck("Mountain", red, "Red reference"),
      deck("Forest", green, "Green reference"),
    ],
  };
}

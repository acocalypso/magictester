export type FormatId =
  | "standard"
  | "pioneer"
  | "modern"
  | "pauper"
  | "legacy"
  | "vintage"
  | "commander"
  | "cedh"
  | "duel";
export interface FormatDefinition {
  id: FormatId;
  name: string;
  enabled: boolean;
  validationSupported: boolean;
  legalityKey: string;
  min: number;
  max: number | null;
  sideboard: number;
  copyLimit: number;
  singleton: boolean;
  commander: boolean;
  players: number;
  startingLife: number;
  engineGameType: "constructed" | "commander";
}
const constructed = (id: FormatId, name: string): FormatDefinition => ({
  id,
  name,
  enabled: true,
  validationSupported: true,
  legalityKey: id,
  min: 60,
  max: null,
  sideboard: 15,
  copyLimit: 4,
  singleton: false,
  commander: false,
  players: 2,
  startingLife: 20,
  engineGameType: "constructed",
});
const commander = (
  id: FormatId,
  name: string,
  players = 4,
): FormatDefinition => ({
  id,
  name,
  enabled: false,
  validationSupported: true,
  legalityKey: id === "cedh" ? "commander" : id,
  min: 100,
  max: 100,
  sideboard: 0,
  copyLimit: 1,
  singleton: true,
  commander: true,
  players,
  startingLife: players === 2 ? 20 : 40,
  engineGameType: "commander",
});
export const FORMATS: readonly FormatDefinition[] = [
  constructed("pauper", "Pauper"),
  constructed("standard", "Standard"),
  constructed("pioneer", "Pioneer"),
  constructed("modern", "Modern"),
  constructed("legacy", "Legacy"),
  constructed("vintage", "Vintage"),
  commander("commander", "Commander"),
  commander("cedh", "cEDH"),
  commander("duel", "Duel Commander", 2),
];
export const getFormat = (id: string) => FORMATS.find((f) => f.id === id);
export const enabledFormatIds = () =>
  FORMATS.filter((f) => f.enabled).map((f) => f.id);
export const validationFormatIds = () =>
  FORMATS.filter((f) => f.validationSupported).map((f) => f.id);

/* SPDX-License-Identifier: GPL-3.0-only
 * Read the pinned Forge card scripts through Forge's own rules parser.
 * This helper is run only by bootstrap, as a separate Java process.
 */
import forge.card.CardRules;
import forge.card.ICardFace;
import com.google.gson.Gson;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.*;

public class CardFacts {
    private static final Set<String> ACTIVATED_KEYWORDS = Set.of(
        "Equip", "Fortify", "Cycling", "TypeCycling", "Transmute", "Transfigure",
        "Ninjutsu", "Commander ninjutsu", "Forecast", "Reinforce", "Level up",
        "Outlast", "Scavenge", "Unearth", "Embalm", "Eternalize", "Encore",
        "Reconfigure", "Crew", "Saddle", "Station", "Craft");
    public static void main(String[] args) throws Exception {
        forge.util.Lang.createInstance("en-US");
        var types = java.nio.file.Files.readAllLines(java.nio.file.Path.of("res/lists/TypeLists.txt"), StandardCharsets.UTF_8);
        for (var section : forge.util.FileSection.parseSections(types).entrySet()) {
            forge.card.CardType.Helper.parseTypes(section.getKey(),section.getValue());
        }
        Map<String,Map<String,Object>> facts = new TreeMap<>();
        Map<String,CardRules> partners = new TreeMap<>();
        List<String> failures = new ArrayList<>();
        CardRules.Reader reader = new CardRules.Reader();
        try (ZipFile archive = new ZipFile(args[0])) {
            var entries = archive.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory() || !entry.getName().endsWith(".txt")) continue;
                try {
                    String text = new String(archive.getInputStream(entry).readAllBytes(), StandardCharsets.UTF_8);
                    CardRules rules = reader.readCard(Arrays.asList(text.split("\\R")), entry.getName());
                    ICardFace face = rules.getMainPart();
                    if (face == null) throw new IllegalArgumentException("CopyFaceFrom-only script needs the full engine database");
                    boolean activated = false;
                    for (String ability : face.getAbilities()) if (ability.trim().startsWith("AB$")) activated = true;
                    List<String> keywords = new ArrayList<>();
                    for (String keyword : face.getKeywords()) {
                        keywords.add(keyword);
                        String name = keyword.split(":",2)[0];
                        for (String known : ACTIVATED_KEYWORDS) if (name.equalsIgnoreCase(known)) activated = true;
                    }
                    for (String type : List.of("Plains","Island","Swamp","Mountain","Forest")) if (face.getType().hasSubtype(type)) activated = true;
                    Map<String,Object> item = new LinkedHashMap<>();
                    item.put("name",rules.getName());
                    item.put("canBeCommander",rules.canBeCommander());
                    item.put("soloCommander",rules.canBeCommander() && (!rules.canBeBackground() || rules.canBeCreature() || face.getOracleText().contains("can be your commander")));
                    item.put("background",rules.canBeBackground());
                    item.put("startingCreature",rules.canBeCreature());
                    item.put("wildColor",rules.getAddsWildCardColor());
                    item.put("hasActivatedAbility",activated);
                    item.put("keywords",keywords);
                    item.put("allowedPartners",new ArrayList<String>());
                    facts.put(rules.getName(),item);
                    // Universes Within versions share the exact rules and deck identity;
                    // Forge CardDb resolves their flavor names to the original script.
                    if (rules.hasFunctionalVariants() && rules.getSupportedFunctionalVariants().contains("UniversesWithin")) {
                        facts.put(rules.getDisplayNameForVariant("UniversesWithin"),item);
                    }
                    if (rules.canBePartnerCommander()) partners.put(rules.getName(),rules);
                } catch (Exception | LinkageError exception) {
                    failures.add(entry.getName()+": "+exception.getClass().getSimpleName()+": "+exception.getMessage());
                }
            }
        }
        for (var pair : partners.entrySet()) {
            List<String> allowed = new ArrayList<>();
            for (var other : partners.entrySet()) if (!pair.getKey().equals(other.getKey()) && pair.getValue().canBePartnerCommanders(other.getValue())) allowed.add(other.getKey());
            facts.get(pair.getKey()).put("allowedPartners",allowed);
        }
        try (Writer writer = new OutputStreamWriter(new FileOutputStream(args[1]),StandardCharsets.UTF_8)) {
            new Gson().toJson(Map.of("schemaVersion",1,"cards",facts,"failures",failures),writer);
        }
    }
}

package com.acocalypso.magictester

import forge.StaticData
import forge.deck.Deck
import forge.deck.DeckSection
import forge.deck.DeckFormat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object EngineValidation {
    fun validate(text: String, format: String, destination: File): JSONObject {
        require(format in DeckText.formats)
        val parsed = DeckText.parse(text)
        val problems = parsed.errors.toMutableList()
        val deck = Deck("MagicTester")
        val canonical = mutableListOf<DeckLine>()
        for (line in parsed.cards) {
            val card = StaticData.instance().commonCards.getCard(CardNames.normalized(line.name))
                ?: StaticData.instance().commonCards.getCard(CardNames.identifier(line.name))
            if (card == null || card.rules.isUnsupported) { problems += "${line.name}: this Forge release has no supported card script."; continue }
            canonical += line.copy(name = card.name)
            val section = when (line.section) { "Commander" -> DeckSection.Commander; "Sideboard", "Companion" -> DeckSection.Sideboard; else -> DeckSection.Main }
            deck.getOrCreate(section).add(card, line.quantity)
        }
        if (problems.isEmpty()) {
            CompanionRules.problem(ParsedDeck(canonical, emptyList()), DeckText.commander(format))?.let { problems += it }
            if (DeckText.commander(format) && parsed.cards.any { it.section == "Sideboard" }) problems += "Commander formats do not use a sideboard. Declare an eligible companion under Companion instead."
            if (!DeckText.commander(format) && parsed.cards.any { it.section == "Commander" }) problems += "The selected format does not use commanders."
        }
        if (problems.isEmpty()) {
            val rules = if (DeckText.commander(format)) DeckFormat.Commander else DeckFormat.Constructed
            // CurrentLegality owns today's format/role bans. The Forge release's
            // multiplayer ban snapshot must not reject a legal Duel list or an unban.
            val data=StaticData.instance(); val previous=data.commanderPredicate
            try {
                data.setCommanderPredicate { true }
                rules.getDeckConformanceProblem(deck)?.let { problems += it }
            } finally { data.setCommanderPredicate(previous) }
            if(DeckText.commander(format)) {
                val commanders=deck.commanders
                if(commanders.size == 1) {
                    val commander=commanders.first().rules
                    if(commander.canBeBackground() && !commander.canBeCreature() && !commander.oracleText.contains("can be your commander")) problems += "A Background needs a compatible commander; it cannot lead this deck alone."
                }
                // Forge allows a colored basic in a colorless deck as a house rule.
                // Standard Commander color identity does not permit that exception.
                if(commanders.isNotEmpty() && commanders.all { it.rules.colorIdentity.color.toInt() == 0 && !it.rules.addsWildCardColor }) {
                    for(entry in deck.main) if(entry.key.rules.type.isBasicLand && entry.key.rules.colorIdentity.color.toInt() != 0) problems += "${entry.key.name} is outside the commanders' color identity."
                }
            }
        }
        val output = ParsedDeck(canonical, emptyList())
        if (problems.isEmpty()) destination.writeText(output.forgeText())
        return JSONObject().put("valid", problems.isEmpty()).put("errors", JSONArray(problems.distinct()))
            .put("cards", JSONArray(canonical.map { JSONObject().put("name", it.name).put("quantity", it.quantity).put("section", it.section) }))
            .put("companion", output.companion ?: JSONObject.NULL)
            .put("engineVersion", BuildConfig.FORGE_VERSION).put("deckPath", destination.absolutePath)
    }
}

package com.acocalypso.magictester

import forge.StaticData
import forge.card.CardRules
import forge.card.ICardFace

/** The starting deck includes commanders, while a companion lives outside it. */
object CompanionRules {
    private val activatedKeywords = setOf("equip","fortify","cycling","typecycling","transmute","transfigure","ninjutsu","commander ninjutsu","forecast","reinforce","level up","outlast","scavenge","unearth","embalm","eternalize","encore","reconfigure","crew","saddle","station","craft","aura swap","specialize")
    private fun activated(rules: CardRules): Boolean {
        val faces = if(rules.splitType == forge.card.CardSplitType.Split) rules.allFaces else listOf(rules.mainPart)
        return faces.any { face -> face.abilities.any { it.trim().startsWith("AB$") } || face.keywords.any { it.substringBefore(':').lowercase() in activatedKeywords } || listOf("Plains","Island","Swamp","Mountain","Forest").any { face.type.hasSubtype(it) } }
    }
    fun problem(deck: ParsedDeck, commander: Boolean): String? {
        val companion=deck.companion ?: return null
        val rules=StaticData.instance().commonCards.getCard(companion)?.rules ?: return "Unknown companion."
        if(!rules.hasStartOfKeyword("Companion")) return "$companion does not have the companion ability."
        if(commander && companion == "Lutri, the Spellchaser") return "Lutri is banned as a companion in Commander and Duel Commander."
        val entries=deck.cards.filter { it.section in listOf("Main","Commander") }.mapNotNull { line -> StaticData.instance().commonCards.getCard(line.name)?.rules?.let { line to it } }
        fun permanent(face: ICardFace) = face.type.isPermanent
        val valid=when(companion) {
            "Gyruda, Doom of Depths" -> entries.all { it.second.manaCost.cmc % 2 == 0 }
            "Jegantha, the Wellspring" -> entries.all { val symbols=Regex("\\{[^}]+}").findAll(it.second.manaCost.toString()).map { m -> m.value }.toList();symbols.size == symbols.toSet().size }
            "Kaheera, the Orphanguard" -> entries.all { (_,r) -> !r.canBeCreature() || r.hasKeyword("Changeling") || r.mainPart.type.hasAllCreatureTypes() || listOf("Cat","Elemental","Nightmare","Dinosaur","Beast").any { r.mainPart.type.hasSubtype(it) } || r.mainPart.staticAbilities.any { it.contains("CharacteristicDefining$ True") && it.contains("AddAllCreatureTypes$ True") } }
            "Keruga, the Macrosage" -> entries.all { it.second.mainPart.type.isLand || it.second.manaCost.cmc >= 3 }
            "Lurrus of the Dream-Den" -> entries.all { !permanent(it.second.mainPart) || it.second.manaCost.cmc <= 2 }
            "Lutri, the Spellchaser" -> entries.filter { !it.second.mainPart.type.isLand }.groupBy { it.second.name }.all { (_,cards) -> cards.sumOf { it.first.quantity } == 1 }
            "Obosh, the Preypiercer" -> entries.all { it.second.mainPart.type.isLand || it.second.manaCost.cmc % 2 == 1 }
            "Umori, the Collector" -> { val nonlands=entries.filter { !it.second.mainPart.type.isLand };nonlands.isEmpty() || nonlands.map { it.second.mainPart.type.coreTypes.toSet() }.reduce { a,b -> a.intersect(b) }.isNotEmpty() }
            "Yorion, Sky Nomad" -> !commander && entries.sumOf { it.first.quantity } >= 80
            "Zirda, the Dawnwaker" -> entries.all { !permanent(it.second.mainPart) || activated(it.second) }
            else -> false
        }
        return if(valid) null else "The starting deck, including commanders, does not satisfy $companion's companion requirement."
    }
}

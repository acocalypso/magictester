package com.acocalypso.magictester

/** Portable text parser shared by imports, validation, persisted jobs and engine input. */
data class DeckLine(val section: String, val name: String, val quantity: Int)
data class ParsedDeck(val cards: List<DeckLine>, val errors: List<String>) {
    fun forgeText() = buildString {
        append("[metadata]\nName=MagicTester\n")
        for (section in listOf("Main", "Commander", "Sideboard")) {
            append("[$section]\n")
            cards.filter { it.section == section || (section == "Sideboard" && it.section == "Companion") }
                .forEach { append("${it.quantity} ${it.name}\n") }
        }
    }
    val companion get() = cards.firstOrNull { it.section == "Companion" }?.name
}
object DeckText {
    private val headings = mapOf("deck" to "Main", "main" to "Main", "mainboard" to "Main", "sideboard" to "Sideboard", "side" to "Sideboard", "commander" to "Commander", "commanders" to "Commander", "companion" to "Companion", "companions" to "Companion", "maybeboard" to "Ignore", "considering" to "Ignore")
    fun parse(text: String): ParsedDeck {
        val errors = mutableListOf<String>(); val cards = mutableListOf<DeckLine>(); var section = "Main"
        if (text.length > 200000) return ParsedDeck(emptyList(), listOf("Deck text exceeds 200 KB."))
        text.lineSequence().forEachIndexed { index, raw ->
            var line = raw.trim().removePrefix("\uFEFF")
            if (line.isEmpty()) return@forEachIndexed
            val heading = line.removePrefix("//").trim().trim('[',']').trimEnd(':').trim().lowercase()
            headings[heading]?.let { section = it; return@forEachIndexed }
            if (line.startsWith("//") || line.startsWith("#")) return@forEachIndexed
            if (section == "Ignore") return@forEachIndexed
            var actualSection = section
            if (line.startsWith("SB:", true)) { line = line.substring(3).trim(); actualSection = "Sideboard" }
            val match = Regex("^(\\d+)x?\\s+(.+)$", RegexOption.IGNORE_CASE).matchEntire(line)
            if (match == null) { errors += "Line ${index+1}: use a quantity followed by a card name."; return@forEachIndexed }
            val quantity = match.groupValues[1].toIntOrNull() ?: 0
            val name = match.groupValues[2].replace(Regex("\\s+\\([A-Za-z0-9]+\\)(?:\\s+[A-Za-z0-9*-]+)?(?:\\s+\\*F\\*)?$"), "").trim()
            if (quantity !in 1..1000 || name.length !in 1..200 || name.any { it == '|' || it == '[' || it == ']' || it.code < 32 }) errors += "Line ${index+1}: invalid card name or quantity."
            else cards += DeckLine(actualSection, name, quantity)
        }
        if (cards.isEmpty()) errors += "Paste a decklist before checking it."
        if (cards.sumOf { it.quantity } > 1000) errors += "A deck may contain at most 1,000 cards."
        if (cards.count { it.section == "Companion" } > 1 || cards.any { it.section == "Companion" && it.quantity != 1 }) errors += "Designate at most one companion."
        return ParsedDeck(cards, errors.distinct())
    }
    val formats = listOf("standard", "pioneer", "modern", "pauper", "legacy", "vintage", "commander", "cedh", "duel")
    fun commander(format: String) = format in listOf("commander", "cedh", "duel")
}

package com.acocalypso.magictester

/** Fast format checks before network access or initializing Forge. Native validation follows. */
object BenchmarkDeckCheck {
    fun problems(text: String,format: String): List<String> {
        require(format in DeckText.formats)
        val parsed=DeckText.parse(text)
        if(parsed.errors.isNotEmpty()) return parsed.errors
        val problems=mutableListOf<String>()
        val commanders=parsed.cards.filter {it.section=="Commander"}.sumOf {it.quantity}
        if(DeckText.commander(format)) {
            if(commanders !in 1..2) problems += "Designate one commander, or two compatible commanders, under Commander."
            if(parsed.cards.any {it.section=="Sideboard"}) problems += "Commander formats do not use a sideboard. Declare an eligible companion under Companion instead."
            val count=parsed.cards.filter {it.section in listOf("Main","Commander")}.sumOf {it.quantity}
            if(count!=100) problems += "Commander requires 100 cards including commanders; this deck has $count."
        } else if(commanders>0) problems += "The selected format does not use commanders."
        return problems
    }
}

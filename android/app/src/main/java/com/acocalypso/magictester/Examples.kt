package com.acocalypso.magictester
object Examples {
    val burn = """Deck
20 Mountain
4 Lightning Bolt
4 Chain Lightning
4 Lava Spike
4 Rift Bolt
4 Shock
4 Incinerate
4 Lightning Strike
4 Searing Blaze
4 Thermo-Alchemist
4 Kessig Flamebreather
"""
    fun commander(name: String = "Bruvac the Grandiloquent") = "Commander\n1 $name\nDeck\n40 Island\n59 Persistent Petitioners\n"
}

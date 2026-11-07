package com.acocalypso.magictester
import org.junit.Test
import org.junit.Assert.*
class DeckTextTest {
    @Test fun pluralCommanderAndPrintingSuffix() {
        val deck = DeckText.parse("// Commanders\n1 Ravos, Soultender (C16) 41\n1 Tymna the Weaver (C16) 48\nDeck\n1 Plains\nSIDEBOARD:\n1 Swords to Plowshares (STA) 10\nMaybeboard\n1 Unknown")
        assertTrue(deck.errors.toString(), deck.errors.isEmpty())
        assertEquals(2, deck.cards.count { it.section == "Commander" })
        assertEquals("Ravos, Soultender", deck.cards.first().name)
        assertFalse(deck.forgeText().contains("Unknown"))
    }
    @Test fun rejectMalformedInsteadOfSilentlyDroppingIt() {
        assertTrue(DeckText.parse("Commander\nTymna the Weaver\nDeck\n1 Plains").errors.isNotEmpty())
        assertTrue(DeckText.parse("999999999999 Mountain").errors.isNotEmpty())
    }
}

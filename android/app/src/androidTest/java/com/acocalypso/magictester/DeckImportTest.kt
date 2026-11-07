package com.acocalypso.magictester
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class)
class DeckImportTest {
    @Test fun moxfieldImportPreservesTwoCommandersAndIgnoresMaybeboard() {
        val (title,text)=DeckLinks.load("https://moxfield.com/decks/AAAAAAAAAAAAAAAAAAAAAA") { url ->
            assertEquals("https://api2.moxfield.com/v2/decks/all/AAAAAAAAAAAAAAAAAAAAAA",url)
            """{"name":"Partner fixture","mainboard":{"a":{"quantity":98,"card":{"name":"Plains"}}},"commanders":{"b":{"quantity":1,"card":{"name":"Ravos, Soultender"}},"c":{"quantity":1,"card":{"name":"Tymna the Weaver"}}},"maybeboard":{"d":{"quantity":1,"card":{"name":"Mountain"}}}}"""
        }
        assertEquals("Partner fixture",title)
        val parsed=DeckText.parse(text)
        assertTrue(parsed.errors.toString(),parsed.errors.isEmpty())
        assertEquals(2,parsed.cards.count { it.section=="Commander" })
        assertEquals(100,parsed.cards.sumOf { it.quantity })
        assertFalse(text.contains("Mountain"))
    }
    @Test fun archidektImportKeepsCommanderAndSideboardRoles() {
        val (_,text)=DeckLinks.load("https://archidekt.com/decks/12345/fixture") {
            """{"name":"Archive fixture","categories":[{"name":"Maybeboard","includedInDeck":false}],"cards":[{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"name":"Bruvac the Grandiloquent"}}},{"quantity":40,"categories":["Land"],"card":{"oracleCard":{"name":"Island"}}},{"quantity":59,"categories":["Advisor"],"card":{"oracleCard":{"name":"Persistent Petitioners"}}},{"quantity":1,"categories":["Maybeboard"],"card":{"oracleCard":{"name":"Mountain"}}}]}"""
        }
        val parsed=DeckText.parse(text)
        assertTrue(parsed.errors.toString(),parsed.errors.isEmpty())
        assertEquals(1,parsed.cards.count { it.section=="Commander" })
        assertEquals(100,parsed.cards.sumOf { it.quantity })
        assertFalse(text.contains("Mountain"))
    }
    @Test(expected=IllegalStateException::class) fun importRejectsUnexpectedHostsBeforeMakingARequest() {
        DeckLinks.load("https://example.com/decks/12345") { error("Unexpected network request") }
    }
}

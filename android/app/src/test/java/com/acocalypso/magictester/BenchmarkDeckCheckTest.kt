package com.acocalypso.magictester

import org.junit.Assert.*
import org.junit.Test

class BenchmarkDeckCheckTest {
    @Test fun pauperDraftIsRejectedUnderEveryCommanderFormat() {
        val text="Deck\n60 Mountain\nSideboard\n4 Pyroblast"
        for(format in listOf("commander","cedh","duel")) {
            val problems=BenchmarkDeckCheck.problems(text,format)
            assertTrue(problems.any {it.contains("commander")})
            assertTrue(problems.any {it.contains("sideboard")})
            assertTrue(problems.any {it.contains("100")})
        }
        assertTrue(BenchmarkDeckCheck.problems(text,"pauper").isEmpty())
    }
    @Test fun pairedCommandersAndCompanionCountSeparately() {
        val text="Commanders\n1 Ravos, Soultender\n1 Tymna the Weaver\nDeck\n98 Plains\nCompanion\n1 Lurrus of the Dream-Den"
        assertTrue(BenchmarkDeckCheck.problems(text,"commander").isEmpty())
        assertTrue(BenchmarkDeckCheck.problems(text,"pauper").any {it.contains("does not use commanders")})
    }
    @Test fun malformedTextIsNotIgnored() {
        assertTrue(BenchmarkDeckCheck.problems("Commander\nTymna the Weaver\nDeck\n99 Plains","commander").any {it.contains("quantity")})
    }
}

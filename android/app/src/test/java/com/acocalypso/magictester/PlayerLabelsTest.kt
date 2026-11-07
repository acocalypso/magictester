package com.acocalypso.magictester
import org.junit.Test
import org.junit.Assert.*
class PlayerLabelsTest {
    @Test fun ownDeckAndEachOpponentHaveDistinctReadableNames() {
        assertEquals("Opponent 1 assigned Augur of Bolas (319) to attack You.",PlayerLabels.readable("player-1 assigned Augur of Bolas (319) to attack player-0."))
        assertEquals("You didn't block Opponent 2. Opponent 3 passed.",PlayerLabels.readable("player-0 didn't block player-2. player-3 passed."))
    }
    @Test fun possessivesAndCommonVerbAgreementRemainReadable() {
        assertEquals("Your graveyard; Opponent 1's hand; Your commander.",PlayerLabels.readable("player-0's graveyard; player-1's hand; player-0’s commander."))
        assertEquals("You were dealt 3 damage. You have priority.",PlayerLabels.readable("player-0 was dealt 3 damage. player-0 has priority."))
    }
    @Test fun aliasesDoNotDamageLongerIdentifiersOrCardReferences() {
        assertEquals("player-10, prefix-player-0, player-0x, Cast Down (275)",PlayerLabels.readable("player-10, prefix-player-0, player-0x, Cast Down (275)"))
    }
}

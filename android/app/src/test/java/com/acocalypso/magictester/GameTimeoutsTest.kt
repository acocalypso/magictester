package com.acocalypso.magictester
import org.junit.Assert.*
import org.junit.Test
class GameTimeoutsTest {
    @Test fun commanderCanFinishLongGamesWithoutChangingConstructedLimits() {
        for(format in listOf("commander","cedh","duel")) {
            assertTrue(GameTimeouts.accepts(format,1800));assertFalse(GameTimeouts.accepts(format,1801))
            assertTrue(GameTimeouts.accepts(format,GameTimeouts.defaultSeconds(format)))
        }
        for(format in listOf("pauper","standard","pioneer","modern","legacy","vintage")) {
            assertTrue(GameTimeouts.accepts(format,300));assertFalse(GameTimeouts.accepts(format,301))
        }
    }
    @Test fun invalidFormatOrZeroClockIsRejected() {
        assertFalse(GameTimeouts.accepts("commander",0));assertFalse(GameTimeouts.accepts("unknown",120))
    }
}

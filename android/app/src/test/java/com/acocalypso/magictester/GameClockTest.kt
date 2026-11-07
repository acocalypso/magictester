package com.acocalypso.magictester
import org.junit.Assert.*
import org.junit.Test
class GameClockTest {
    @Test fun activeClockUsesMonotonicStartAndDoesNotFreezeAtTimeout() {
        assertEquals(127000L,GameClock.elapsed(1000,128000,true,5000))
        assertEquals(310000L,GameClock.elapsed(1000,311000,true,0))
        assertEquals("2:07",GameClock.format(127000))
        assertEquals("5:10",GameClock.format(310000))
    }
    @Test fun completedAndInterruptedClocksKeepRecordedTime() {
        assertEquals(14000L,GameClock.elapsed(1000,999000,false,14000))
        assertEquals(14000L,GameClock.elapsed(99000,1000,true,14000))
        assertEquals("0:00",GameClock.format(-1))
    }
}

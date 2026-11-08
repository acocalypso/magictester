package com.acocalypso.magictester

import org.junit.Assert.*
import org.junit.Test

class MatchupStatisticsTest {
    @Test fun retriesNeverTurnTimeoutsIntoLossesOrDoubleCountFinishedMatches() {
        val rows=listOf(MatchupRecord(0,"timeout",null),MatchupRecord(0,"normal",0),MatchupRecord(1,"normal",1),MatchupRecord(0,"normal",0),MatchupRecord(2,"rule_draw",null))
        val c=MatchupStatistics.group(rows,4,1,2).single()
        assertEquals(1,c.wins);assertEquals(1,c.losses);assertEquals(1,c.draws);assertEquals(3,c.finished)
        assertEquals(1,c.unfinished);assertEquals(1,c.failedAttempts);assertEquals(1.0/3,c.rate!!,0.0001)
    }
    @Test fun scheduleWrapsAndUntestedOpponentsHaveNoInventedRate() {
        val rows=listOf(MatchupRecord(0,"normal",0),MatchupRecord(3,"normal",1),MatchupRecord(1,"normal",0))
        val groups=MatchupStatistics.group(rows,5,3,2)
        assertEquals(listOf(2,2,1),groups.map {it.planned});assertEquals(0.5,groups[0].rate!!,0.0)
        assertNull(groups[2].rate);assertNull(groups[2].interval)
        assertEquals(0,MatchupStatistics.group(emptyList(),2,3,2)[2].planned)
        assertEquals(listOf(2,0,1),OpponentSchedule.indices(2,3,4))
        assertEquals(2,OpponentSchedule.seats("pauper",4));assertEquals(4,OpponentSchedule.seats("commander",4))
    }
    @Test fun matchingPairsUseOnlyAllowedIndicesWhileRetainingUnpairedCounts() {
        val rows=listOf(MatchupRecord(0,"normal",0),MatchupRecord(1,"normal",0))
        val counts=MatchupStatistics.group(rows,2,1,2,setOf(1)).single()
        assertEquals(1,counts.wins);assertEquals(2,counts.observedFinished);assertEquals(1,counts.unpaired);assertEquals(0,counts.unfinished)
    }
    @Test fun oneWinHasWideConfidenceAndMoreGamesNarrowTheInterval() {
        val one=MatchupCounts(1,1).interval!!;val many=MatchupCounts(100,100).interval!!
        assertTrue(one.first<0.21);assertEquals(1.0,one.second,0.0001)
        assertTrue(many.second-many.first<one.second-one.first)
        val zero=MatchupCounts(1,0,1).interval!!;assertEquals(0.0,zero.first,0.0001);assertTrue(zero.second>0.79)
    }
    @Test fun malformedAndOutOfRangeOutcomesAreExcluded() {
        val rows=listOf(MatchupRecord(-1,"normal",0),MatchupRecord(99,"normal",0),MatchupRecord(0,"normal",null),MatchupRecord(1,"normal",7))
        val c=MatchupStatistics.group(rows,2,1,2).single()
        assertEquals(0,c.finished);assertEquals(2,c.unfinished);assertEquals(2,c.failedAttempts)
    }
}

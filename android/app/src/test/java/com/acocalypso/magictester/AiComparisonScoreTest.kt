package com.acocalypso.magictester

import org.junit.Assert.*
import org.junit.Test

class AiComparisonScoreTest {
    @Test fun comparesOnlyMatchedIndicesAndReportsPercentagePointsNotRelativeGain() {
        val score=AiComparisonScore.calculate(mapOf(0 to true,1 to false,2 to false,3 to true),mapOf(0 to true,1 to true,2 to false,4 to true))
        assertEquals(3,score.pairs);assertEquals(1,score.defaultWins);assertEquals(2,score.experimentalWins)
        assertEquals(1,score.extraWins);assertEquals(1,score.gainedWins);assertEquals(0,score.lostWins)
        assertEquals(100.0/3,score.percentagePoints,0.00001)
    }
    @Test fun zeroBaselineNegativeAndEmptyResultsStayWellDefined() {
        assertEquals(100.0,AiComparisonScore.calculate(mapOf(0 to false),mapOf(0 to true)).percentagePoints,0.0)
        val worse=AiComparisonScore.calculate(mapOf(0 to true),mapOf(0 to false))
        assertEquals(-1,worse.extraWins);assertEquals(1,worse.lostWins);assertEquals(-100.0,worse.percentagePoints,0.0)
        assertNull(AiComparisonScore(4,2,2,0,0).chanceProbability)
        assertEquals(1.0,AiComparisonScore(4,2,2,1,1).chanceProbability!!,1e-12)
        assertEquals(0.0625,AiComparisonScore(10,2,7,5,0).chanceProbability!!,1e-12) // 2 * (1/2)^5
        assertEquals(0.021484375,AiComparisonScore(20,5,13,9,1).chanceProbability!!,1e-12) // 2 * 11/1024
        assertEquals(AiComparisonScore(20,13,5,1,9).chanceProbability!!,AiComparisonScore(20,5,13,9,1).chanceProbability!!,0.0)
        assertTrue(AiComparisonScore(20,5,13,9,1).verdict.contains("unlikely to be luck"))
        assertEquals(1.0,AiComparisonScore(1100,550,550,550,550).chanceProbability!!,0.03) // large even split stays "chance"
        assertTrue(AiComparisonScore(1100,400,700,700,400).chanceProbability!!<1e-6)
        assertTrue(AiComparisonScore(10,2,7,5,0).verdict.contains("not yet evidence"))
        val empty=AiComparisonScore.calculate(mapOf(0 to true),emptyMap())
        assertEquals(0,empty.pairs);assertEquals(0.0,empty.percentagePoints,0.0)
    }
}

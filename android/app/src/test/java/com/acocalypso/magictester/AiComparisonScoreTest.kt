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
        val empty=AiComparisonScore.calculate(mapOf(0 to true),emptyMap())
        assertEquals(0,empty.pairs);assertEquals(0.0,empty.percentagePoints,0.0)
    }
}

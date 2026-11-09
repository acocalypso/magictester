package com.acocalypso.magictester

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AiComparisonEvidenceTest {
    private fun pair()=AiComparison.prepare(JSONObject().put("aiPolicy",AiPolicy.EXPANDED).put("deck","Frozen deck").put("format","pauper").put("players",2)
        .put("games",3).put("bestOf",1).put("seed",123).put("engineVersion","2.0.15").put("engineBuildSha256","hash").put("clockSeconds",120)
        .put("opponents",JSONArray().put(JSONObject().put("name","Native opponent").put("text","Frozen opponent"))),"comparison-fixture")
    private fun result(index: Int,policy: String,winner: Int?,termination: String="normal",opponent: String=policy)=JSONObject().put("index",index).put("unit","game").put("termination",termination)
        .put("winner",winner ?: JSONObject.NULL).put("gameSeed",123+index).put("clockSeconds",120).put("engineVersion","2.0.15").put("engineBuildSha256","hash")
        .put("ai",JSONObject().put("seats",JSONArray().put(JSONObject().put("seat",0).put("id",policy)).put(JSONObject().put("seat",1).put("id",opponent))))
    @Test fun unfinishedMatchesAndMismatchedClocksAreExcludedWithoutInventingLosses() {
        val pair=pair()
        val defaults=listOf(result(0,AiPolicy.STABLE,1),result(1,AiPolicy.STABLE,0),result(2,AiPolicy.STABLE,0))
        val experimental=listOf(result(0,AiPolicy.EXPANDED,0),result(1,AiPolicy.EXPANDED,null,"timeout"),result(2,AiPolicy.EXPANDED,0).put("clockSeconds",300))
        val report=AiComparisonEvidence.summarize(pair[0],pair[1],defaults,experimental)
        assertEquals(1,report.score!!.pairs);assertEquals(1,report.score.extraWins);assertEquals(1,report.excludedPairs)
    }
    @Test fun drawIsFinishedButNotAWinAndNativeOpponentsAreRejectedInAllPlayerMode() {
        val pair=pair()
        val baseline=result(0,AiPolicy.STABLE,null,"rule_draw")
        val experiment=result(0,AiPolicy.EXPANDED,0)
        val report=AiComparisonEvidence.summarize(pair[0],pair[1],listOf(baseline),listOf(experiment))
        assertEquals(1,report.score!!.pairs);assertEquals(0,report.score.defaultWins);assertEquals(1,report.score.experimentalWins)
        experiment.getJSONObject("ai").getJSONArray("seats").getJSONObject(1).put("id",AiPolicy.STABLE)
        val invalid=AiComparisonEvidence.summarize(pair[0],pair[1],listOf(baseline),listOf(experiment))
        assertEquals(0,invalid.score!!.pairs);assertEquals(1,invalid.excludedPairs)
    }
    @Test fun changedFrozenDeckOrEngineCannotProduceAStrengthClaim() {
        val pair=pair();pair[1].put("deck","Different deck")
        assertNull(AiComparisonEvidence.summarize(pair[0],pair[1],emptyList(),emptyList()).score)
        val fresh=pair()
        val report=AiComparisonEvidence.summarize(fresh[0],fresh[1],listOf(result(0,AiPolicy.STABLE,1)),listOf(result(0,AiPolicy.EXPANDED,0).put("engineBuildSha256","different")))
        assertEquals(0,report.score!!.pairs);assertEquals(1,report.excludedPairs)
    }
    @Test fun strategicPolicyCanBeComparedWithStrategicOpponents() {
        val pair=pair();pair[1].put("aiPolicy",AiPolicy.STRATEGIC)
        val report=AiComparisonEvidence.summarize(pair[0],pair[1],listOf(result(0,AiPolicy.STABLE,1)),listOf(result(0,AiPolicy.STRATEGIC,0)))
        assertEquals(1,report.score!!.pairs);assertEquals(1,report.score.extraWins)
    }
    @Test fun legacyOwnDeckComparisonsKeepTheirOriginalScopeAndEvidenceRules() {
        val pair=pair();pair[1].put("aiScope",AiPolicy.YOUR_DECK)
        val defaults=listOf(result(0,AiPolicy.STABLE,1))
        val legacy=result(0,AiPolicy.EXPANDED,0,opponent=AiPolicy.STABLE)
        val report=AiComparisonEvidence.summarize(pair[0],pair[1],defaults,listOf(legacy))
        assertEquals(1,report.score!!.pairs);assertTrue(report.message.contains("Legacy comparison"))
        assertEquals(0,AiComparisonEvidence.summarize(pair[0],pair[1],defaults,listOf(result(0,AiPolicy.EXPANDED,0))).score!!.pairs)
        assertEquals(AiPolicy.YOUR_DECK,pair[1].getString("aiScope"))
    }
    @Test fun everyCommanderSeatAndEveryBo3GameMustMatchTheSavedScope() {
        for((format,seats,bestOf) in listOf(Triple("commander",4,1),Triple("pauper",2,3))) {
            val pair=pair();for(p in pair) {p.put("format",format).put("players",seats).put("bestOf",bestOf)}
            fun game(policy: String)=JSONObject().put("ai",JSONObject().put("seats",JSONArray().apply {for(seat in 0 until seats)put(JSONObject().put("seat",seat).put("id",policy))}))
            fun outcome(policy: String,winner: Int)=result(0,policy,winner).apply {
                if(bestOf==3)put("unit","match").put("games",JSONArray().put(game(policy)).put(game(policy)))
                else put("ai",game(policy).getJSONObject("ai"))
            }
            val a=outcome(AiPolicy.STABLE,1);val b=outcome(AiPolicy.EXPANDED,0)
            assertEquals(1,AiComparisonEvidence.summarize(pair[0],pair[1],listOf(a),listOf(b)).score!!.pairs)
            val leaf=if(bestOf==3)b.getJSONArray("games").getJSONObject(1) else b
            leaf.getJSONObject("ai").getJSONArray("seats").getJSONObject(seats-1).put("id",AiPolicy.STABLE)
            assertEquals(0,AiComparisonEvidence.summarize(pair[0],pair[1],listOf(a),listOf(b)).score!!.pairs)
        }
    }
}

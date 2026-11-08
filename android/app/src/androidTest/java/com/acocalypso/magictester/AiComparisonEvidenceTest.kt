package com.acocalypso.magictester

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AiComparisonEvidenceTest {
    private fun pair()=AiComparison.prepare(JSONObject().put("aiPolicy",AiPolicy.EXPANDED).put("deck","Frozen deck").put("format","pauper").put("players",2)
        .put("games",3).put("bestOf",1).put("seed",123).put("engineVersion","2.0.15").put("engineBuildSha256","hash").put("clockSeconds",120)
        .put("opponents",JSONArray().put(JSONObject().put("name","Native opponent").put("text","Frozen opponent"))),"comparison-fixture")
    private fun result(index: Int,policy: String,winner: Int?,termination: String="normal")=JSONObject().put("index",index).put("unit","game").put("termination",termination)
        .put("winner",winner ?: JSONObject.NULL).put("gameSeed",123+index).put("clockSeconds",120).put("engineVersion","2.0.15").put("engineBuildSha256","hash")
        .put("ai",JSONObject().put("seats",JSONArray().put(JSONObject().put("seat",0).put("id",policy)).put(JSONObject().put("seat",1).put("id",AiPolicy.STABLE))))
    @Test fun unfinishedMatchesAndMismatchedClocksAreExcludedWithoutInventingLosses() {
        val pair=pair()
        val defaults=listOf(result(0,AiPolicy.STABLE,1),result(1,AiPolicy.STABLE,0),result(2,AiPolicy.STABLE,0))
        val experimental=listOf(result(0,AiPolicy.EXPANDED,0),result(1,AiPolicy.EXPANDED,null,"timeout"),result(2,AiPolicy.EXPANDED,0).put("clockSeconds",300))
        val report=AiComparisonEvidence.summarize(pair[0],pair[1],defaults,experimental)
        assertEquals(1,report.score!!.pairs);assertEquals(1,report.score.extraWins);assertEquals(1,report.excludedPairs)
    }
    @Test fun drawIsFinishedButNotAWinAndExperimentalOpponentsAreRejected() {
        val pair=pair()
        val baseline=result(0,AiPolicy.STABLE,null,"rule_draw")
        val experiment=result(0,AiPolicy.EXPANDED,0)
        val report=AiComparisonEvidence.summarize(pair[0],pair[1],listOf(baseline),listOf(experiment))
        assertEquals(1,report.score!!.pairs);assertEquals(0,report.score.defaultWins);assertEquals(1,report.score.experimentalWins)
        experiment.getJSONObject("ai").getJSONArray("seats").getJSONObject(1).put("id",AiPolicy.EXPANDED)
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
}

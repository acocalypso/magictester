package com.acocalypso.magictester
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONArray
import org.json.JSONObject

class AiComparisonTest {
    private fun settings()=JSONObject().put("title","Comparison").put("deck","Deck\n60 Mountain").put("format","commander")
        .put("players",4).put("games",10).put("clockSeconds",900).put("seed",55).put("aiPolicy",AiPolicy.EXPANDED)
        .put("engineBuildSha256","frozen-build").put("opponents",JSONArray().put(JSONObject().put("text","Deck\n60 Island")))
    @Test fun pairedSettingsFreezeInputsAndOnlyChangeTheCandidateSeat() {
        val source=settings();val original=source.toString();val pair=AiComparison.prepare(source,"group")
        assertEquals(original,source.toString());assertEquals(2,pair.size)
        for(setting in pair) for(key in listOf("deck","format","players","games","clockSeconds","seed","engineBuildSha256","opponents")) assertEquals(source.get(key).toString(),setting.get(key).toString())
        val baseline=SimulationRequest.unit(pair[0],2);val candidate=SimulationRequest.unit(pair[1],2)
        assertEquals("group",pair[0].getString("comparisonId"));assertEquals("group",pair[1].getString("comparisonId"))
        for(i in 0..3) assertEquals("stable",baseline.getJSONArray("aiPolicies").getString(i))
        assertEquals("tactical-v2",candidate.getJSONArray("aiPolicies").getString(0))
        for(i in 1..3) assertEquals("stable",candidate.getJSONArray("aiPolicies").getString(i))
        assertEquals(baseline.getJSONArray("rawDecks").toString(),candidate.getJSONArray("rawDecks").toString())
        assertEquals("frozen-build",candidate.getString("expectedEngineBuildSha256"))
        pair[0].getJSONArray("opponents").getJSONObject(0).put("text","Changed")
        assertEquals(source.getJSONArray("opponents").toString(),pair[1].getJSONArray("opponents").toString())
    }
    @Test fun nativeVsNativeComparisonIsRejected() {
        try {AiComparison.prepare(settings().put("aiPolicy",AiPolicy.STABLE));fail("No candidate selected")}catch(_:IllegalArgumentException) {}
    }
    @Test fun stampedResultsKeepNativeMetadataAndIncludeEveryBo3Game() {
        val event=JSONObject().put("type","result").put("result",JSONObject().put("ai",JSONObject().put("schemaVersion",1)).put("games",JSONArray().put(JSONObject()).put(JSONObject())))
        EngineBuild.annotate(event,"hash","0.1.8")
        val result=event.getJSONObject("result");assertEquals(1,result.getJSONObject("ai").getInt("schemaVersion"))
        assertEquals("hash",result.getString("engineBuildSha256"))
        for(i in 0..1) assertEquals("hash",result.getJSONArray("games").getJSONObject(i).getString("engineBuildSha256"))
        EngineBuild.requireExpected("","hash");EngineBuild.requireExpected("hash","hash")
        try {EngineBuild.requireExpected("other","hash");fail("Mixed implementation accepted")}catch(_:IllegalArgumentException) {}
    }
}

package com.acocalypso.magictester

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.json.JSONArray
import org.json.JSONObject

@RunWith(AndroidJUnit4::class)
class AiPolicyRequestTest {
    private fun payload(format: String="commander")=JSONObject().put("deck","Deck\n60 Mountain")
        .put("opponents",JSONArray().put(JSONObject().put("text","Deck\n60 Island")))
        .put("format",format).put("players",4).put("games",2).put("seed",123).put("clockSeconds",300)
    @Test fun olderRunsRemainStableAndCandidateAppliesEquallyToAllSeats() {
        for(format in DeckText.formats) {
            val source=payload(format)
            val stable=SimulationRequest.unit(source,0)
            val seats=if(format in listOf("commander","cedh")) 4 else 2
            assertEquals(seats,stable.getJSONArray("aiPolicies").length())
            for(i in 0 until seats) assertEquals("stable",stable.getJSONArray("aiPolicies").getString(i))
            source.put("aiPolicy","tactical-v1")
            val candidate=SimulationRequest.unit(source,1)
            for(i in 0 until seats) assertEquals("tactical-v1",candidate.getJSONArray("aiPolicies").getString(i))
            assertEquals(1,candidate.getJSONArray("indices").getInt(0))
            assertEquals(123,candidate.getInt("seed"))
            source.put("aiPolicy",AiPolicy.EXPANDED).put("aiScope",AiPolicy.YOUR_DECK).put("engineBuildSha256","frozen")
            val expanded=SimulationRequest.unit(source,1)
            assertEquals(AiPolicy.EXPANDED,expanded.getJSONArray("aiPolicies").getString(0))
            for(i in 1 until seats) assertEquals(AiPolicy.STABLE,expanded.getJSONArray("aiPolicies").getString(i))
            assertEquals("frozen",expanded.getString("expectedEngineBuildSha256"))
        }
    }
    @Test fun unsupportedPolicyFailsBeforeEngineWork() {
        try {SimulationRequest.unit(payload().put("aiPolicy","unknown"),0);fail("Unsupported policy accepted")}
        catch(_:IllegalArgumentException) {}
    }
}

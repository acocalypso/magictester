package com.acocalypso.magictester
import org.json.JSONObject
import java.util.UUID

object AiComparison {
    /** Deep copies retain the exact same frozen decks, seed, clock, format and engine build. */
    fun prepare(source: JSONObject,id: String=UUID.randomUUID().toString()): List<JSONObject> {
        val candidate=AiPolicy.checked(source.optString("aiPolicy",AiPolicy.STABLE))
        require(candidate!=AiPolicy.STABLE) {"Choose an experimental policy to compare with native Forge."}
        require(id.isNotBlank())
        val baseline=JSONObject(source.toString()).put("aiPolicy",AiPolicy.STABLE).put("aiScope",AiPolicy.ALL)
            .put("comparisonId",id).put("comparisonRole","baseline")
        val experiment=JSONObject(source.toString()).put("aiPolicy",candidate).put("aiScope",AiPolicy.YOUR_DECK)
            .put("comparisonId",id).put("comparisonRole","candidate")
        return listOf(baseline,experiment)
    }
}

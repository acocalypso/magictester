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
        val experiment=JSONObject(source.toString()).put("aiPolicy",candidate).put("aiScope",AiPolicy.ALL)
            .put("comparisonId",id).put("comparisonRole","candidate")
        return listOf(baseline,experiment)
    }
    fun scopeDescription(candidate: JSONObject?): String=when(candidate?.optString("aiScope",AiPolicy.ALL)) {
        AiPolicy.ALL -> "Native AI pilots every deck in the baseline. The selected AI pilots your deck and every opponent in the candidate. This compares matchup results when all players switch AI; it does not isolate an improvement to your deck's pilot."
        AiPolicy.YOUR_DECK -> "Legacy comparison: the selected AI pilots your deck only, against native opponents. This saved analysis retains its original AI settings."
        else -> "The candidate AI scope cannot be confirmed. Keep both linked analyses to inspect the configuration."
    }
    fun scopeSummary(scope: String)=if(scope==AiPolicy.YOUR_DECK) "legacy: candidate on your deck; native opponents" else "native for all players vs candidate for all players"
}

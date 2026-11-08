package com.acocalypso.magictester
import org.json.JSONArray
import org.json.JSONObject
object SimulationRequest {
    fun unit(payload: JSONObject,unit: Int): JSONObject {
        val opponents=payload.getJSONArray("opponents")
        require(opponents.length()>0) { "Select an opponent deck." }
        val decks=JSONArray().put(payload.getString("deck"))
        val format=payload.getString("format")
        val seats=OpponentSchedule.seats(format,payload.optInt("players",4))
        val policies=AiPolicy.seats(payload.optString("aiPolicy",AiPolicy.STABLE),seats,payload.optString("aiScope",AiPolicy.ALL))
        for(index in OpponentSchedule.indices(unit,opponents.length(),seats)) decks.put(opponents.getJSONObject(index).getString("text"))
        return JSONObject().put("expectedEngineBuildSha256",payload.optString("engineBuildSha256")).put("aiPolicies",JSONArray(policies)).put("rawDecks",decks).put("format",format).put("games",payload.getInt("games")).put("indices",JSONArray(listOf(unit)))
            .put("seed",payload.getInt("seed")).put("clockSeconds",payload.getInt("clockSeconds"))
            .put("mode",if(format=="duel") "duel" else if(DeckText.commander(format)) "commander" else "constructed")
            .put("bestOf",payload.optInt("bestOf",1)).put("sideboarding",payload.optInt("bestOf")==3).put("maxMatchGames",5)
    }
}

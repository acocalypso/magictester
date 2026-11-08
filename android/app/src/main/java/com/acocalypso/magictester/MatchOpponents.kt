package com.acocalypso.magictester

import org.json.JSONObject

/** The saved match index and frozen pool define seats, including on retry. */
object MatchOpponents {
    fun names(payload: JSONObject,unit: Int): List<String> {
        val pool=payload.optJSONArray("opponents") ?: return emptyList()
        val seats=OpponentSchedule.seats(payload.optString("format"),payload.optInt("players",4))
        if(unit<0 || pool.length()==0 || seats !in 2..4)return emptyList()
        return OpponentSchedule.indices(unit,pool.length(),seats).map {index->
            pool.optJSONObject(index)?.optString("name")?.takeIf {it.isNotBlank() && it!="null"} ?: "Unnamed opponent deck"
        }
    }
}

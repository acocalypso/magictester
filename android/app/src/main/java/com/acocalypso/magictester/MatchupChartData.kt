package com.acocalypso.magictester

import org.json.JSONObject

data class MatchupGroup(val title: String,val opponents: List<String>)
data class MatchupChartRow(val label: String,val groups: List<MatchupCounts>) {
    val total get()=groups.fold(MatchupCounts()) {a,b->a+b}
}
data class MatchupChartData(val title: String,val deck: String,val multiplayer: Boolean,val groups: List<MatchupGroup>,val rows: List<MatchupChartRow>,val note: String,val provenance: String="")

object MatchupCharts {
    private fun records(results: List<JSONObject>)=results.map {MatchupRecord(it.optInt("index",-1),it.optString("termination"),if(it.isNull("winner")) null else it.optInt("winner",-1))}
    fun totals(payload: JSONObject,results: List<JSONObject>): MatchupCounts {
        val rows=records(results);val seats=OpponentSchedule.seats(payload.optString("format"),payload.optInt("players",4))
        if(seats !in 2..4)return MatchupCounts()
        val games=if(payload.optString("kind")=="benchmark") (rows.maxOfOrNull {it.index.toLong()+1} ?: 0L).coerceIn(0,Int.MAX_VALUE.toLong()).toInt() else payload.optInt("games").coerceAtLeast(0)
        return MatchupStatistics.group(rows,games,1,seats).single()
    }
    fun build(run: Run,results: List<JSONObject>,peer: Run?=null,peerResults: List<JSONObject> = emptyList()): MatchupChartData? {
        val payload=run.payload;val pool=payload.optJSONArray("opponents") ?: return null
        if(pool.length()==0 || payload.optString("kind")=="benchmark")return null
        val seats=OpponentSchedule.seats(payload.optString("format"),payload.optInt("players",4));if(seats !in 2..4)return null
        val multiplayer=seats>2
        val groups=(0 until pool.length()).map {index->
            val names=OpponentSchedule.indices(index,pool.length(),seats).map {pool.getJSONObject(it).optString("name","Opponent ${it+1}")}
            MatchupGroup(if(multiplayer) "Pod ${index+1}" else names.first(),names)
        }
        fun row(source: Run,rows: List<JSONObject>,allowed: Set<Int>?=null)=MatchupChartRow(AiPolicy.label(source.payload.optString("aiPolicy",AiPolicy.STABLE)).substringBefore(" ·"),
            MatchupStatistics.group(records(rows),source.payload.optInt("games"),pool.length(),seats,allowed))
        var rows=listOf(row(run,results));var pairScope: String?=null;var note="Recorded match wins ÷ finished matches; draws are included in the denominator. Unfinished attempts are excluded."
        if(peer!=null && payload.optString("comparisonId").isNotBlank()) {
            val baseline=if(payload.optString("comparisonRole")=="baseline")run else peer
            val candidate=if(payload.optString("comparisonRole")=="candidate")run else peer
            val defaults=if(baseline.id==run.id)results else peerResults
            val experiments=if(candidate.id==run.id)results else peerResults
            val comparison=AiComparisonEvidence.summarize(baseline.payload,candidate.payload,defaults,experiments)
            if(comparison.score!=null) {
                rows=listOf(row(baseline,defaults,comparison.matchedIndices),row(candidate,experiments,comparison.matchedIndices))
                pairScope=candidate.payload.optString("aiScope",AiPolicy.ALL)
                note="Linked comparison: matching finished outcomes with the same seed, clock, engine and expected AI policies. Draws are not wins. "+AiComparison.scopeSummary(pairScope)+"."
            } else note="Showing this analysis only. ${comparison.message}"
        } else if(payload.has("comparisonId"))note="Showing this analysis only; the linked analysis is unavailable. $note"
        if(multiplayer)note="Pod win rates describe the entire multiplayer table, not individual head-to-head matchups. $note"
        val provenance="Forge ${payload.optString("engineVersion","not recorded")} · configured seed ${payload.optString("seed","not recorded")} · best-of-${payload.optInt("bestOf",1)} · configured limit ${payload.optString("clockSeconds","not recorded")}s"+
            payload.optString("engineBuildSha256").takeIf {it.isNotBlank()}?.let {" · engine ${it.take(12)}"}.orEmpty()
        val format=when(payload.optString("format")) {"cedh"->"cEDH";"duel"->"Duel Commander";else->payload.optString("format").replaceFirstChar {it.uppercase()}}
        return MatchupChartData("$format matchup chart",payload.optString("title","Your deck"),multiplayer,groups,rows,note,provenance+" · AI: "+if(pairScope!=null) AiComparison.scopeSummary(pairScope) else AiPolicy.scopeLabel(payload.optString("aiScope",AiPolicy.ALL)))
    }
}

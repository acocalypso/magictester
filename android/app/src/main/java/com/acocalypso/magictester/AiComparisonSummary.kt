package com.acocalypso.magictester

import org.json.JSONObject

/** Compare only match indices with usable outcomes on both sides. Draws are not wins. */
data class AiComparisonScore(val pairs: Int,val defaultWins: Int,val experimentalWins: Int,val gainedWins: Int,val lostWins: Int) {
    val extraWins get()=experimentalWins-defaultWins
    val percentagePoints get()=if(pairs==0) 0.0 else 100.0*extraWins/pairs
    companion object {
        fun calculate(default: Map<Int,Boolean>,experimental: Map<Int,Boolean>): AiComparisonScore {
            val indices=default.keys.intersect(experimental.keys)
            return AiComparisonScore(indices.size,indices.count {default[it]==true},indices.count {experimental[it]==true},
                indices.count {default[it]==false && experimental[it]==true},indices.count {default[it]==true && experimental[it]==false})
        }
    }
}

data class AiComparisonSummary(val score: AiComparisonScore?=null,val message: String,val excludedPairs: Int=0)

object AiComparisonEvidence {
    private fun successful(rows: List<JSONObject>)=rows.filter {it.optString("termination") in listOf("normal","rule_draw")}
        .associateBy {it.optInt("index",-1)} // The last completed retry is authoritative, as in RunStore.

    fun summarize(baseline: JSONObject,candidate: JSONObject,defaultRows: List<JSONObject>,experimentalRows: List<JSONObject>): AiComparisonSummary {
        val group=baseline.optString("comparisonId")
        if(group.isBlank() || candidate.optString("comparisonId")!=group || baseline.optString("comparisonRole")!="baseline" || candidate.optString("comparisonRole")!="candidate")
            return AiComparisonSummary(message="A linked native and experimental analysis is required.")
        if(baseline.optString("aiPolicy")!=AiPolicy.STABLE || candidate.optString("aiPolicy") !in listOf(AiPolicy.TACTICAL,AiPolicy.EXPANDED) || candidate.optString("aiScope")!=AiPolicy.YOUR_DECK)
            return AiComparisonSummary(message="These analyses do not isolate experimental AI on your deck against native opponents.")
        for(key in listOf("deck","format","players","games","bestOf","seed","engineVersion","engineBuildSha256","opponents")) {
            if(baseline.opt(key)?.toString()!=candidate.opt(key)?.toString()) return AiComparisonSummary(message="Comparison unavailable: the $key settings differ. Start a new linked comparison.")
        }
        val defaults=successful(defaultRows);val experiments=successful(experimentalRows)
        val seats=if(candidate.optString("format") in listOf("commander","cedh")) candidate.optInt("players",4) else 2
        fun policiesMatch(row: JSONObject,policy: String): Boolean {
            val games=row.optJSONArray("games")
            if(games!=null) return games.length()>0 && (0 until games.length()).all {policiesMatch(games.getJSONObject(it),policy)}
            val evidence=row.optJSONObject("ai")?.optJSONArray("seats") ?: return false
            if(evidence.length()!=seats) return false
            return (0 until seats).all {seat->
                val entry=evidence.getJSONObject(seat)
                entry.optInt("seat",-1)==seat && entry.optString("id")==if(seat==0) policy else AiPolicy.STABLE
            }
        }
        val goodDefaults=mutableMapOf<Int,Boolean>();val goodExperiments=mutableMapOf<Int,Boolean>()
        var excluded=0
        for(index in defaults.keys.intersect(experiments.keys)) {
            val a=defaults.getValue(index);val b=experiments.getValue(index)
            val comparable=index in 0 until baseline.optInt("games") &&
                listOf("gameSeed","clockSeconds","unit","engineVersion","engineBuildSha256").all {a.has(it) && a.opt(it)?.toString()==b.opt(it)?.toString()} &&
                a.optString("engineBuildSha256").isNotBlank() && policiesMatch(a,AiPolicy.STABLE) && policiesMatch(b,candidate.getString("aiPolicy"))
            if(!comparable) {excluded++;continue}
            goodDefaults[index]=!a.isNull("winner") && a.optInt("winner",-1)==0
            goodExperiments[index]=!b.isNull("winner") && b.optInt("winner",-1)==0
        }
        val score=AiComparisonScore.calculate(goodDefaults,goodExperiments)
        return AiComparisonSummary(score,if(score.pairs==0) "Waiting for comparable finished matches in both analyses." else "Observed results for the same match indices. This measures your deck in the selected pool, not overall AI strength.",excluded)
    }
}

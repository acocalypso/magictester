package com.acocalypso.magictester

import org.json.JSONObject

/** Compare only match indices with usable outcomes on both sides. Draws are not wins. */
data class AiComparisonScore(val pairs: Int,val defaultWins: Int,val experimentalWins: Int,val gainedWins: Int,val lostWins: Int) {
    val extraWins get()=experimentalWins-defaultWins
    val percentagePoints get()=if(pairs==0) 0.0 else 100.0*extraWins/pairs
    /**
     * Exact two-sided sign test on matches whose result changed. It answers: if both AIs were
     * equally good, how often would gained and lost wins split at least this unevenly? Null when
     * no result changed. Matches with the same result in both runs carry no information here.
     */
    val chanceProbability: Double? get() {
        val n=gainedWins+lostWins
        if(n==0) return null
        val k=minOf(gainedWins,lostWins)
        if(n>1000) { // The exact terms underflow here; the normal approximation is accurate at this size.
            val z=((n/2.0-k-0.5)/kotlin.math.sqrt(n/4.0)).coerceAtLeast(0.0)
            val t=1/(1+0.2316419*z)
            val upper=kotlin.math.exp(-z*z/2)/kotlin.math.sqrt(2*Math.PI)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))))
            return (2*upper).coerceAtMost(1.0)
        }
        var term=1.0;var tail=0.0 // C(n,i)/2^n, built up without overflow
        repeat(n) {term/=2.0}
        for(i in 0..k) {tail+=term;term=term*(n-i)/(i+1)}
        return (2*tail).coerceAtMost(1.0)
    }
    val verdict: String get() {
        val p=chanceProbability ?: return "No match changed its result, so this sample shows no difference."
        val percent=String.format(java.util.Locale.US,"%.0f",100*p)
        return if(p<0.05) "A split this uneven would happen by chance only about $percent% of the time. The difference is unlikely to be luck."
        else "A split this uneven would happen by chance about $percent% of the time. This is not yet evidence of a real difference; run more matches."
    }
    companion object {
        fun calculate(default: Map<Int,Boolean>,experimental: Map<Int,Boolean>): AiComparisonScore {
            val indices=default.keys.intersect(experimental.keys)
            return AiComparisonScore(indices.size,indices.count {default[it]==true},indices.count {experimental[it]==true},
                indices.count {default[it]==false && experimental[it]==true},indices.count {default[it]==true && experimental[it]==false})
        }
    }
}

data class AiComparisonSummary(val score: AiComparisonScore?=null,val message: String,val excludedPairs: Int=0,val matchedIndices: Set<Int> = emptySet())

object AiComparisonEvidence {
    private fun successful(rows: List<JSONObject>)=rows.filter {it.optString("termination") in listOf("normal","rule_draw")}
        .associateBy {it.optInt("index",-1)} // The last completed retry is authoritative, as in RunStore.

    fun summarize(baseline: JSONObject,candidate: JSONObject,defaultRows: List<JSONObject>,experimentalRows: List<JSONObject>): AiComparisonSummary {
        val group=baseline.optString("comparisonId")
        if(group.isBlank() || candidate.optString("comparisonId")!=group || baseline.optString("comparisonRole")!="baseline" || candidate.optString("comparisonRole")!="candidate")
            return AiComparisonSummary(message="A linked native and experimental analysis is required.")
        val candidateScope=candidate.optString("aiScope",AiPolicy.ALL)
        if(baseline.optString("aiPolicy")!=AiPolicy.STABLE || baseline.optString("aiScope",AiPolicy.ALL)!=AiPolicy.ALL || candidate.optString("aiPolicy") !in AiPolicy.options.filter {it!=AiPolicy.STABLE} || candidateScope !in listOf(AiPolicy.ALL,AiPolicy.YOUR_DECK))
            return AiComparisonSummary(message="These analyses do not have supported native baseline and candidate AI settings.")
        for(key in listOf("deck","format","players","games","bestOf","seed","engineVersion","engineBuildSha256","opponents")) {
            if(baseline.opt(key)?.toString()!=candidate.opt(key)?.toString()) return AiComparisonSummary(message="Comparison unavailable: the $key settings differ. Start a new linked comparison.")
        }
        val defaults=successful(defaultRows);val experiments=successful(experimentalRows)
        val seats=if(candidate.optString("format") in listOf("commander","cedh")) candidate.optInt("players",4) else 2
        fun policiesMatch(row: JSONObject,policy: String,scope: String): Boolean {
            val games=row.optJSONArray("games")
            if(games!=null) return games.length()>0 && (0 until games.length()).all {policiesMatch(games.getJSONObject(it),policy,scope)}
            val evidence=row.optJSONObject("ai")?.optJSONArray("seats") ?: return false
            if(evidence.length()!=seats) return false
            return (0 until seats).all {seat->
                val entry=evidence.getJSONObject(seat)
                entry.optInt("seat",-1)==seat && entry.optString("id")==if(scope==AiPolicy.YOUR_DECK && seat>0) AiPolicy.STABLE else policy
            }
        }
        val goodDefaults=mutableMapOf<Int,Boolean>();val goodExperiments=mutableMapOf<Int,Boolean>()
        var excluded=0
        fun validOutcome(row: JSONObject)=row.optString("termination")=="rule_draw" || (!row.isNull("winner") && row.optInt("winner",-1) in 0 until seats)
        for(index in defaults.keys.intersect(experiments.keys)) {
            val a=defaults.getValue(index);val b=experiments.getValue(index)
            val comparable=index in 0 until baseline.optInt("games") &&
                listOf("gameSeed","clockSeconds","unit","engineVersion","engineBuildSha256").all {a.has(it) && a.opt(it)?.toString()==b.opt(it)?.toString()} &&
                a.optString("engineBuildSha256").isNotBlank() && validOutcome(a) && validOutcome(b) && policiesMatch(a,AiPolicy.STABLE,AiPolicy.ALL) && policiesMatch(b,candidate.getString("aiPolicy"),candidateScope)
            if(!comparable) {excluded++;continue}
            goodDefaults[index]=a.optString("termination")=="normal" && !a.isNull("winner") && a.optInt("winner",-1)==0
            goodExperiments[index]=b.optString("termination")=="normal" && !b.isNull("winner") && b.optInt("winner",-1)==0
        }
        val score=AiComparisonScore.calculate(goodDefaults,goodExperiments)
        return AiComparisonSummary(score,if(score.pairs==0) "Waiting for comparable finished matches in both analyses." else "Observed results for the same match indices. "+AiComparison.scopeDescription(candidate),excluded,goodDefaults.keys.toSet())
    }
}

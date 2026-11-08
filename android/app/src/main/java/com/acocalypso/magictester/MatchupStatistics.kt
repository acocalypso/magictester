package com.acocalypso.magictester

import kotlin.math.sqrt

object OpponentSchedule {
    fun seats(format: String,requested: Int)=if(format in listOf("commander","cedh")) requested else 2
    fun indices(unit: Int,poolSize: Int,seats: Int): List<Int> {
        require(unit>=0 && poolSize>0 && seats in 2..4)
        return (1 until seats).map {(unit+it-1)%poolSize}
    }
}

data class MatchupRecord(val index: Int,val termination: String,val winner: Int?)
data class MatchupCounts(val planned: Int=0,val wins: Int=0,val losses: Int=0,val draws: Int=0,val observedFinished: Int=0,val failedAttempts: Int=0) {
    val finished get()=wins+losses+draws
    val unfinished get()=(planned-observedFinished).coerceAtLeast(0)
    val unpaired get()=(observedFinished-finished).coerceAtLeast(0)
    val rate: Double? get()=if(finished==0) null else wins.toDouble()/finished
    val interval: Pair<Double,Double>? get() {
        val p=rate ?: return null;val n=finished.toDouble();val z2=3.8416;val d=1+z2/n
        val middle=(p+z2/(2*n))/d;val radius=1.96*sqrt(p*(1-p)/n+z2/(4*n*n))/d
        return (middle-radius).coerceAtLeast(0.0) to (middle+radius).coerceAtMost(1.0)
    }
    operator fun plus(other: MatchupCounts)=MatchupCounts(planned+other.planned,wins+other.wins,losses+other.losses,draws+other.draws,observedFinished+other.observedFinished,failedAttempts+other.failedAttempts)
}

object MatchupStatistics {
    /** Each scheduled index contributes at most one completed match, including best-of-three results. */
    fun group(records: List<MatchupRecord>,games: Int,poolSize: Int,seats: Int,allowed: Set<Int>?=null): List<MatchupCounts> {
        require(games>=0 && poolSize>0 && seats in 2..4)
        val planned=IntArray(poolSize) {games/poolSize+if(it<games%poolSize)1 else 0}
        val complete=linkedMapOf<Int,MatchupRecord>();val failures=IntArray(poolSize)
        for(r in records) {
            if(r.index !in 0 until games)continue
            if(r.termination=="rule_draw" || (r.termination=="normal" && r.winner!=null && r.winner in 0 until seats)) complete[r.index]=r
            else failures[r.index%poolSize]++
        }
        val wins=IntArray(poolSize);val losses=IntArray(poolSize);val draws=IntArray(poolSize);val observed=IntArray(poolSize)
        for((index,r) in complete) {
            val group=index%poolSize;observed[group]++
            if(allowed!=null && index !in allowed)continue
            if(r.termination=="rule_draw")draws[group]++ else if(r.winner==0)wins[group]++ else losses[group]++
        }
        return (0 until poolSize).map {MatchupCounts(planned[it],wins[it],losses[it],draws[it],observed[it],failures[it])}
    }
}

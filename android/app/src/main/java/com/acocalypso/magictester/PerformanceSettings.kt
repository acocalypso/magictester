package com.acocalypso.magictester

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import org.json.JSONObject

object CapacityMath {
    const val MAX_ENGINES=4
    fun cpuLimit(cores: Int)=(cores/2).coerceIn(1,MAX_ENGINES)
    fun reserveMiB(totalMiB: Long)=maxOf(512L,totalMiB/5)
    fun memoryLimit(availableMiB: Long,totalMiB: Long,processMiB: Long)=((availableMiB-reserveMiB(totalMiB)).coerceAtLeast(0)/processMiB.coerceAtLeast(384)).toInt().coerceIn(0,MAX_ENGINES)
    fun recommendation(samples: List<Pair<Int,Double>>): Int {
        var count=1;var best=0.0
        for((level,rate) in samples.sortedBy { it.first }) if(rate>best*1.05) { count=level;best=rate }
        return count
    }
}
object PerformanceSettings {
    fun profile(format: String,players: Int=4)=if(DeckText.commander(format)) "commander-${if(format=="duel") 2 else players}" else "constructed"
    private fun prefs(context: Context)=context.getSharedPreferences("performance",Context.MODE_PRIVATE)
    fun identity(context: Context): String=Build.FINGERPRINT+":"+context.assets.open("engine-manifest.json").bufferedReader().use { JSONObject(it.readText()).getString("engineJarSha256") }
    fun report(context: Context,profile: String): JSONObject? = runCatching { prefs(context).getString("report-$profile",null)?.let { JSONObject(it) }?.takeIf { it.optString("identity")==identity(context) } }.getOrNull()
    fun save(context: Context,profile: String,report: JSONObject) { prefs(context).edit().putString("report-$profile",report.toString()).apply() }
    fun selected(context: Context)=prefs(context).getInt("parallelLimit",0).coerceIn(0,CapacityMath.MAX_ENGINES)
    fun select(context: Context,value: Int) { require(value in 0..CapacityMath.MAX_ENGINES);prefs(context).edit().putInt("parallelLimit",value).apply() }
    fun limit(context: Context,profile: String): Int {
        val report=report(context,profile)
        val tested=report?.optInt("maxStable",1)?.coerceAtLeast(1) ?: 1
        val chosen=selected(context)
        return minOf(if(chosen==0) report?.optInt("recommended",1) ?: 1 else chosen,tested,CapacityMath.cpuLimit(Runtime.getRuntime().availableProcessors())).coerceAtLeast(1)
    }
    fun processBudgetMiB(context: Context,profile: String): Long = maxOf(if(profile.startsWith("commander")) 512L else 384L,report(context,profile)?.optLong("processBudgetMiB",512) ?: 512L)
    fun resources(context: Context): JSONObject {
        val manager=context.getSystemService(ActivityManager::class.java)
        val memory=ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
        val thermal=if(Build.VERSION.SDK_INT>=29) context.getSystemService(PowerManager::class.java).currentThermalStatus else 0
        return JSONObject().put("availableMiB",memory.availMem/1048576).put("totalMiB",memory.totalMem/1048576).put("lowMemory",memory.lowMemory).put("thermal",thermal).put("largeHeapMiB",manager.largeMemoryClass).put("cores",Runtime.getRuntime().availableProcessors())
    }
    fun candidates(context: Context,profile: String): Int {
        val r=resources(context)
        if(r.getBoolean("lowMemory") || r.getInt("thermal")>=PowerManager.THERMAL_STATUS_SEVERE) return 0
        return minOf(CapacityMath.cpuLimit(r.getInt("cores")),CapacityMath.memoryLimit(r.getLong("availableMiB"),r.getLong("totalMiB"),processBudgetMiB(context,profile)))
    }
}

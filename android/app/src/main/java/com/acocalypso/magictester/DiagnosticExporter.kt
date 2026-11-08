package com.acocalypso.magictester

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

object DiagnosticExporter {
    fun device(context: Context): JSONObject {
        val manager=context.getSystemService(ActivityManager::class.java)
        val memory=ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
        val power=context.getSystemService(PowerManager::class.java)
        return JSONObject().put("appVersion",BuildConfig.VERSION_NAME).put("versionCode",BuildConfig.VERSION_CODE).put("buildType",BuildConfig.BUILD_TYPE)
            .put("forgeVersion",BuildConfig.FORGE_VERSION).put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL).put("androidVersion",Build.VERSION.RELEASE)
            .put("sdk",Build.VERSION.SDK_INT).put("abis",JSONArray(Build.SUPPORTED_ABIS.toList())).put("cpuCores",Runtime.getRuntime().availableProcessors())
            .put("largeHeapMiB",manager.largeMemoryClass).put("freeMemoryMiB",memory.availMem/1048576).put("totalMemoryMiB",memory.totalMem/1048576)
            .put("lowMemory",memory.lowMemory).put("freeStorageMiB",context.filesDir.usableSpace/1048576).put("powerSaveMode",power.isPowerSaveMode)
            .put("thermalStatus",if(Build.VERSION.SDK_INT>=29) power.currentThermalStatus else JSONObject.NULL)
            .put("backgroundRunStatus",BackgroundRunStatus.snapshot(context))
    }
    private fun events(context: Context, runId: String?): List<JSONObject> {
        val queue=java.util.PriorityQueue<JSONObject>(compareBy { it.optLong("timestamp") })
        for(file in Diagnostics.directory(context).listFiles().orEmpty().filter { it.name.startsWith("events-") && it.isFile }) runCatching {
            file.useLines { lines -> lines.forEach { line ->
                val event=runCatching { JSONObject(line) }.getOrNull()
                if(event!=null && (runId==null || event.isNull("runId") || event.optString("runId")==runId)) {
                    queue.add(event);if(queue.size>5000) queue.poll()
                }
            } }
        }
        return queue.toList().sortedBy { it.optLong("timestamp") }
    }
    private fun readable(event: JSONObject): String=buildString {
        append("${event.optString("time")}  ${event.optString("level")}  ${event.optString("event")}  ${event.optString("message")}\n")
        if(!event.isNull("runId")) append("  Run: ${event.optString("runId")}\n")
        event.optJSONObject("details")?.let { details -> details.keys().forEach { key -> append("  $key: ${details.opt(key)}\n") } }
        if(event.has("stack")) append(event.getString("stack")+"\n")
    }
    private fun processExits(context: Context): String {
        if(Build.VERSION.SDK_INT<30) return "Android 11 or later is required for historical OS process-exit reasons. App and engine logs are included separately.\n"
        return runCatching {
            val reasons=mapOf(0 to "unknown",1 to "application requested exit",2 to "operating-system signal",3 to "low memory",4 to "Java crash",5 to "native crash",6 to "application not responding",7 to "initialization failed",8 to "permission change",9 to "excessive resource use",10 to "user requested stop",11 to "user stopped",12 to "dependency died",13 to "other")
            val entries=context.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(context.packageName,0,20)
            buildString {
                append("Controlled Forge cleanup/cancellation is recorded as engine.retired in timeline.txt; Android may list those processes as signal exits.\n\n")
                if(entries.isEmpty()) append("No historical process exits reported by Android.\n")
                for(entry in entries) append("${Instant.ofEpochMilli(entry.timestamp)}  ${entry.processName}  PID ${entry.pid}\nReason: ${reasons[entry.reason] ?: "reason ${entry.reason}"}; status ${entry.status}; PSS ${entry.pss} KiB; RSS ${entry.rss} KiB\n${entry.description.orEmpty()}\n\n")
            }
        }.getOrElse { "Android could not provide process-exit history: ${it.message}\n" }
    }
    private fun logcat(): String {
        val executor=Executors.newSingleThreadExecutor()
        var process: java.lang.Process?=null
        return try {
            process=ProcessBuilder("logcat","-d","-t","1500","-v","threadtime").redirectErrorStream(true).start()
            val input=process.inputStream
            val reader=executor.submit<String> {
                input.use { stream ->
                    val bytes=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                    while(bytes.size()<1024*1024) { val n=stream.read(buffer,0,minOf(buffer.size,1024*1024-bytes.size()));if(n<0) break;bytes.write(buffer,0,n) }
                    bytes.toString("UTF-8")
                }
            }
            reader.get(4,TimeUnit.SECONDS).ifBlank { "No application logcat entries were available.\n" }
        } catch(error:Exception) { "Application logcat could not be collected: ${error.message}. Persistent app/engine logs are included separately.\n" }
        finally { process?.destroy();executor.shutdownNow() }
    }
    fun write(context: Context, output: OutputStream, runId: String?=null, includeDecklists: Boolean=false) {
        val capturedAt=Instant.now().toString()
        Diagnostics.event("diagnostics.export","Diagnostic export requested",runId,details=JSONObject().put("includeDecklists",includeDecklists))
        val device=device(context)
        val timeline=events(context,runId)
        var databaseError: String?=null
        val store=RunStore(context)
        val runs=try { if(runId==null) store.recent(30) else listOfNotNull(store.get(runId)) } catch(error:Exception) { databaseError=error.stackTraceToString();emptyList() } finally { store.close() }
        ZipOutputStream(output).use { zip ->
            var budget=20L*1024*1024
            val omissions=mutableListOf<String>()
            fun text(name: String, value: String) {
                val bytes=value.toByteArray()
                val essential=name in listOf("README.txt","summary.txt","omissions.txt","device.json","engine-manifest.json","process-exits.txt") || name.endsWith("settings.json")
                if(!essential && bytes.size>budget) { omissions += "$name omitted: diagnostic size limit reached.";return }
                zip.putNextEntry(ZipEntry(name));zip.write(bytes);zip.closeEntry()
                if(!essential) budget-=bytes.size
            }
            fun file(name: String, source: File, limit: Long=2L*1024*1024) {
                if(!source.isFile) return
                if(budget<=0) { omissions += "$name omitted: diagnostic size limit reached.";return }
                val maximum=minOf(limit,budget)
                try {
                    zip.putNextEntry(ZipEntry(name));var count=0L
                    source.inputStream().use { input -> val buffer=ByteArray(32768);while(count<maximum) { val n=input.read(buffer,0,minOf(buffer.size.toLong(),maximum-count).toInt());if(n<0) break;zip.write(buffer,0,n);count+=n } }
                    zip.closeEntry();budget-=count
                    if(source.length()>count) omissions += "$name contains its first $count bytes; the remaining content exceeded the export limit."
                } catch(error:Exception) { omissions += "$name could not be read: ${error.message}";runCatching { zip.closeEntry() } }
            }
            text("README.txt","MagicTester diagnostic bundle\nCaptured: $capturedAt\n\nStart with summary.txt, then errors.txt and timeline.txt.\nEngine stdout/stderr files preserve Java errors from Forge. process-exits.txt contains Android's own explanations where supported.\n\nThis bundle contains app/device details, run settings, errors and game actions, which can include card names. Complete decklists ${if(includeDecklists) "were included by request" else "were excluded"}. No other application's logs, account credentials, device serial number or Android ID are requested.\nLogs rotate at 2 MiB per stream and are retained for up to seven days within a 24 MiB budget. Diagnostic evidence has an additional 20 MiB export limit; omissions are listed explicitly. The timeline contains the last 5,000 matching events. Active-run exports are snapshots; later activity may produce additional evidence. Full game-result export remains available separately.\n")
            text("summary.txt",buildString {
                append("MagicTester ${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_TYPE}) · Forge ${BuildConfig.FORGE_VERSION}\nCaptured: $capturedAt\n")
                append("Device: ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\n")
                append("Memory now: ${device.optLong("freeMemoryMiB")} MiB free; large heap ${device.optInt("largeHeapMiB")} MiB. Free storage: ${device.optLong("freeStorageMiB")} MiB.\n\n")
                if(runId!=null && runs.isEmpty()) append("No stored run was available for $runId. Its diagnostic events may still be present.\n")
                if(runs.isEmpty() && runId==null) append("No analyses were stored. Setup and startup logs are included.\n")
                for(run in runs) append("Run ${run.id}\n${run.payload.optString("title","Untitled")} · ${run.payload.optString("format")} · ${run.state}\n${run.label}\nSaved matches: ${run.completed}/${run.payload.optInt("games")}; timeout ${run.payload.optInt("clockSeconds")} s; seed ${run.payload.optInt("seed")}.\n\n")
                for(run in runs) for(game in run.liveGames) {
                    val elapsed=GameClock.elapsed(game.optLong("startedElapsedMs"),android.os.SystemClock.elapsedRealtime(),run.state=="running" && game.optBoolean("active"),game.optLong("elapsedMs"))
                    append("Run ${run.id}: match ${game.optInt("unitIndex")+1}, game ${game.optInt("gameIndex")+1}: ${GameClock.format(elapsed)} elapsed; ${game.optInt("clockSeconds")} s limit.\n")
                }
                val errors=timeline.filter { it.optString("level") in listOf("ERROR","WARN") }
                append("Recorded warnings/errors: ${errors.size}. See errors.txt for full messages and stack traces.\n")
                databaseError?.let { append("The history database could not be read. Existing logs were exported; see database-error.txt.\n") }
            })
            text("device.json",device.put("engineAdmission",PerformanceSettings.resources(context).put("singleEngineHeadroomMiB",CapacityMath.SINGLE_RESERVE_MIB).put("setupProcessBudgetMiB",PerformanceSettings.processBudgetMiB(context,"constructed"))).toString(2))
            text("performance-settings.json",JSONObject().put("selectedParallelLimit",PerformanceSettings.selected(context)).put("mode",if(PerformanceSettings.selected(context)==0) "automatic" else "manual").put("reports",JSONObject().apply {
                for(profile in listOf("constructed","commander-2","commander-3","commander-4")) PerformanceSettings.report(context,profile)?.let { put(profile,it) }
            }).toString(2))
            text("errors.txt",timeline.filter { it.optString("level") in listOf("ERROR","WARN") }.joinToString("\n") { readable(it) }.ifBlank { "No warnings or errors were recorded in the retained app events. Check engine stderr, process exits and logcat for additional evidence.\n" })
            text("timeline.txt",timeline.joinToString("\n") { readable(it) }.ifBlank { "No matching app events were retained.\n" })
            databaseError?.let { text("database-error.txt",it) }
            text("process-exits.txt",processExits(context));text("logcat.txt",logcat())
            runCatching { context.assets.open("engine-manifest.json").bufferedReader().use { text("engine-manifest.json",it.readText()) } }
            val logFiles=Diagnostics.directory(context).listFiles().orEmpty().filter { it.isFile && (it.name.startsWith("crash-") || (it.name.startsWith("threads-") && (runId==null || it.name.startsWith("threads-$runId-"))) || (it.name.startsWith("engine-") && (runId==null || it.name.startsWith("engine-$runId-")))) }.sortedByDescending { it.lastModified() }
            for(log in logFiles) file("engine-and-crash-logs/${log.name}",log)
            for(run in runs) {
                val settings=JSONObject().put("runId",run.id).put("state",run.state).put("lastMessage",run.label).put("completed",run.completed)
                for(key in listOf("title","format","games","clockSeconds","bestOf","players","seed","engineVersion","engineBuildSha256","aiPolicy","aiScope","comparisonId","comparisonRole","comparisonSettingsChanged","processRecoveryAttempts","createdAt","legality","kind","benchmarkReport")) if(run.payload.has(key)) settings.put(key,run.payload.opt(key))
                run.liveGame?.let { settings.put("liveGame",it) }
                settings.put("opponentCount",run.payload.optJSONArray("opponents")?.length() ?: 0)
                text("runs/${run.id}/settings.json",settings.toString(2))
                if(includeDecklists) text("runs/${run.id}/decklists.txt",buildString { append("YOUR DECK\n${run.payload.optString("deck")}\n");val opponents=run.payload.optJSONArray("opponents") ?: JSONArray();for(i in 0 until opponents.length()) { val opponent=opponents.getJSONObject(i);append("\nOPPONENT ${i+1}: ${opponent.optString("name")}\n${opponent.optString("text")}\n") } })
                val attempts=File(File(context.filesDir,"runs"),run.id).listFiles().orEmpty().filter { it.name.endsWith(".jsonl") }.sortedByDescending { it.lastModified() }
                attempts.take(10).forEach { file("runs/${run.id}/attempts/${it.name}",it) }
                if(attempts.size>10) omissions += "Run ${run.id}: included the last 10 of ${attempts.size} attempts."
            }
            text("omissions.txt",omissions.joinToString("\n").ifBlank { "No evidence files were omitted or truncated by the diagnostic exporter.\n" })
        }
    }
}

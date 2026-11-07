package com.acocalypso.magictester

import android.content.Context
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

object RunEvents { val changes=MutableStateFlow(0L);fun changed() { changes.update { it+1 } } }
data class Run(val id: String, val state: String, val label: String, val completed: Int, val payload: JSONObject, val liveGame: JSONObject?=null) {
    val liveGames: List<JSONObject> get() { val group=liveGame?.optJSONObject("parallelGames") ?: return listOfNotNull(liveGame);return group.keys().asSequence().map { group.getJSONObject(it) }.toList().sortedBy { it.optInt("unitIndex") } }
}
class RunStore(private val appContext: Context) : SQLiteOpenHelper(appContext, "runs.db", null, 2) {
    companion object { private val evidenceLock=Any() }
    private val directory = File(appContext.filesDir, "runs").apply { mkdirs() }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE runs (id TEXT PRIMARY KEY, state TEXT NOT NULL, label TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, created INTEGER NOT NULL, live_game TEXT)")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        if(old<2) db.execSQL("ALTER TABLE runs ADD COLUMN live_game TEXT")
    }
    private fun row(c: android.database.Cursor)=Run(c.getString(0),c.getString(1),c.getString(2),c.getInt(3),JSONObject(c.getString(4)),if(c.isNull(5)) null else JSONObject(c.getString(5)))
    fun all(): List<Run> = readableDatabase.rawQuery("SELECT id,state,label,completed,payload,live_game FROM runs ORDER BY created DESC,rowid DESC", null).use { c -> buildList { while(c.moveToNext()) add(row(c)) } }
    fun recent(limit: Int): List<Run> = readableDatabase.rawQuery("SELECT id,state,label,completed,payload,live_game FROM runs ORDER BY created DESC,rowid DESC LIMIT ?",arrayOf(limit.coerceIn(1,100).toString())).use { c -> buildList { while(c.moveToNext()) add(row(c)) } }
    fun get(id: String): Run? = readableDatabase.rawQuery("SELECT id,state,label,completed,payload,live_game FROM runs WHERE id=?",arrayOf(id)).use { if(it.moveToFirst()) row(it) else null }
    fun create(payload: JSONObject,initialState: String="queued"): String {
        require(initialState in listOf("queued","importing"))
        require(payload.toString().toByteArray().size <= 1000000) { "The frozen deck pool exceeds 1 MB. Select fewer opponents." }
        val id = UUID.randomUUID().toString()
        writableDatabase.insertOrThrow("runs", null, ContentValues().apply { put("id",id);put("state",initialState);put("label",if(initialState=="queued") "Waiting for the local engine" else "Importing saved analysis");put("payload",payload.toString());put("created",System.currentTimeMillis()) })
        File(directory,id).mkdirs()
        Diagnostics.event("run.$initialState",if(initialState=="queued") "Analysis added to the local queue" else "Restoring an exported analysis",id,details=JSONObject().put("format",payload.optString("format")).put("games",payload.optInt("games")).put("clockSeconds",payload.optInt("clockSeconds")).put("seed",payload.optInt("seed")))
        RunEvents.changed();return id
    }
    fun claim(id: String): Boolean {
        val updated=writableDatabase.update("runs",ContentValues().apply {put("state","running");put("label","Checking device resources")},"id=? AND state='queued'",arrayOf(id))>0
        if(updated) RunEvents.changed()
        return updated
    }
    fun next(): Run? = readableDatabase.rawQuery("SELECT id,state,label,completed,payload,live_game FROM runs WHERE state='queued' ORDER BY created,rowid LIMIT 1",null).use { if(it.moveToFirst()) row(it) else null }
    fun update(id: String, state: String, label: String, completed: Int? = null, onlyIfRunning: Boolean=false) {
        val db=writableDatabase
        db.beginTransaction()
        try {
            if(onlyIfRunning && get(id)?.state!="running") { db.setTransactionSuccessful();return }
            if(state!="running") stopGame(id,state)
            db.update("runs", ContentValues().apply { put("state", state);put("label",label);completed?.let { put("completed",it) } },"id=?",arrayOf(id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        Diagnostics.event("run.$state",label,id,level=if(state=="failed") "ERROR" else "INFO",details=JSONObject().put("completed",completed ?: JSONObject.NULL))
        RunEvents.changed()
    }
    private fun games(value: JSONObject?): MutableMap<String,JSONObject> {
        if(value==null) return linkedMapOf()
        val group=value.optJSONObject("parallelGames")
        if(group!=null) return group.keys().asSequence().associateWith { JSONObject(group.getJSONObject(it).toString()) }.toMutableMap()
        return linkedMapOf(value.optInt("unitIndex").toString() to JSONObject(value.toString()).apply { remove("parallelGames") })
    }
    private fun grouped(values: Map<String,JSONObject>): JSONObject {
        val primary=values.values.firstOrNull { it.optBoolean("active") } ?: values.values.last()
        return JSONObject(primary.toString()).put("parallelGames",JSONObject().apply { values.forEach { (key,value) -> put(key,value) } })
    }
    fun updatePayload(id: String,payload: JSONObject) { writableDatabase.update("runs",ContentValues().apply {put("payload",payload.toString())},"id=?",arrayOf(id));RunEvents.changed() }
    fun recover() {
        val db=writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery("SELECT id,live_game FROM runs WHERE state='running'",null).use { cursor ->
                while(cursor.moveToNext()) {
                    val live=if(cursor.isNull(1)) null else JSONObject(cursor.getString(1))
                    val values=games(live)
                    values.values.filter { it.optBoolean("active") }.forEach { it.put("active",false).put("estimated",true).put("termination","interrupted") }
                    db.update("runs",ContentValues().apply {put("state","interrupted");put("label","Android stopped this run. Resume to continue from saved results.");if(values.isNotEmpty()) put("live_game",grouped(values).toString())},"id=?",arrayOf(cursor.getString(0)))
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun gameEvent(id: String,event: JSONObject) {
        val db=writableDatabase;db.beginTransaction()
        try {
            val run=get(id) ?: return
            if(run.state!="running") return
            val values=games(run.liveGame);val key=event.optInt("index").toString()
            val value=when(event.optString("type")) {
                "game_started" -> JSONObject().put("active",true).put("unitIndex",event.optInt("index")).put("gameIndex",event.optInt("gameIndex")).put("gameSeed",event.optInt("gameSeed"))
                    .put("startedAtEpochMs",event.getLong("startedAtEpochMs")).put("startedElapsedMs",event.getLong("startedElapsedMs")).put("clockSeconds",event.getInt("clockSeconds")).put("elapsedMs",0).put("estimated",false)
                "game_finished" -> {
                    val current=values[key] ?: return
                    if(current.optInt("gameIndex")!=event.optInt("gameIndex")) return
                    JSONObject(current.toString()).put("active",false).put("elapsedMs",event.optLong("durationMs")).put("termination",event.optString("termination")).put("estimated",false)
                }
                else -> return
            }
            values[key]=value
            db.update("runs",ContentValues().apply {put("live_game",grouped(values).toString())},"id=? AND state='running'",arrayOf(id))
            db.setTransactionSuccessful()
        } finally {db.endTransaction()}
        RunEvents.changed()
    }
    fun checkpointGame(id: String) {
        val run=get(id) ?: return
        if(run.state!="running" || run.liveGames.none { it.optBoolean("active") }) return
        val original=run.liveGame!!.toString();val values=games(run.liveGame)
        for(game in values.values) if(game.optBoolean("active")) game.put("elapsedMs",GameClock.elapsed(game.optLong("startedElapsedMs"),android.os.SystemClock.elapsedRealtime(),true,game.optLong("elapsedMs")))
        writableDatabase.update("runs",ContentValues().apply {put("live_game",grouped(values).toString())},"id=? AND state='running' AND live_game=?",arrayOf(id,original))
    }
    private fun stopGame(id: String,reason: String) {
        val run=get(id) ?: return
        val current=run.liveGame ?: return
        val original=current.toString();val values=games(current)
        for(game in values.values) if(game.optBoolean("active")) game.put("active",false).put("termination",reason).put("elapsedMs",GameClock.elapsed(game.optLong("startedElapsedMs"),android.os.SystemClock.elapsedRealtime(),true,game.optLong("elapsedMs")))
        writableDatabase.update("runs",ContentValues().apply {put("live_game",grouped(values).toString())},"id=? AND live_game=?",arrayOf(id,original))
    }
    fun resume(id: String, clock: Int) {
        val run = get(id) ?: return
        require(run.state !in listOf("running", "queued", "complete")); require(GameTimeouts.accepts(run.payload.getString("format"),clock))
        val payload = run.payload.put("clockSeconds",clock)
        writableDatabase.update("runs",ContentValues().apply { put("payload",payload.toString());putNull("live_game");put("state","queued");put("label",if(payload.optString("kind")=="benchmark") "Rerunning device performance measurements" else "Resuming unfinished matches") },"id=?",arrayOf(id))
        Diagnostics.event("run.resumed","Unfinished matches requeued",id,details=JSONObject().put("clockSeconds",clock))
        RunEvents.changed()
    }
    fun saveAttempt(id: String, source: File, unit: Int): File? = synchronized(evidenceLock) {
        if(get(id)?.state!="running") return@synchronized null
        val destination=file(id,"${unit.toString().padStart(5,'0')}-${System.currentTimeMillis()}.jsonl")
        source.copyTo(destination)
        destination
    }
    fun delete(id: String): Boolean = synchronized(evidenceLock) {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,80}")))
        val removed=writableDatabase.delete("runs","id=?",arrayOf(id))>0
        File(directory,id).deleteRecursively()
        Diagnostics.directory(appContext).listFiles().orEmpty().filter { it.name.startsWith("engine-$id-") || it.name.startsWith("threads-$id-") }.forEach { it.delete() }
        Diagnostics.event("run.deleted","Analysis and its saved evidence were deleted",id)
        RunEvents.changed()
        removed
    }
    fun file(id: String, name: String) = File(File(directory,id),name)
    fun results(id: String): List<JSONObject> = File(directory,id).listFiles().orEmpty().filter { it.name.endsWith(".jsonl") }.sortedBy { it.name }.flatMap { file -> file.useLines { lines -> lines.mapNotNull { line -> try { JSONObject(line).takeIf { it.optString("type") == "result" }?.getJSONObject("result") } catch (_: Exception) { null } }.toList() } }
    fun successfulIndices(id: String) = results(id).filter { it.optString("termination") in listOf("normal", "rule_draw") }.map { it.optInt("index") }.toSet()
    /** Restore a v1 export under a fresh ID, without scheduling any engine work. */
    fun importExport(text: String): String {
        require(text.toByteArray().size<=32*1024*1024) {"Analysis export exceeds the 32 MiB import limit."}
        val archive=JSONObject(text)
        require(archive.optInt("schemaVersion")==1 && archive.optString("application")=="MagicTester Android") {"Choose an analysis JSON from Runs → Export results and game evidence, not a diagnostic ZIP."}
        val payload=JSONObject(archive.getJSONObject("settings").toString())
        require(payload.optString("format") in DeckText.formats && payload.opt("deck") is String && payload.optString("deck").isNotBlank()) {"The export has no readable deck/format settings."}
        val total=payload.optInt("games")
        require(total in 1..100 && GameTimeouts.accepts(payload.optString("format"),payload.optInt("clockSeconds")) && payload.optString("engineVersion").isNotBlank()) {"The export has invalid analysis settings."}
        require(payload.has("seed") && payload.optInt("players",4) in 2..4 && payload.optInt("bestOf",1) in listOf(1,3)) {"The export has invalid seed/player/match settings."}
        val opponents=payload.optJSONArray("opponents")
        require(opponents!=null && opponents.length()>0) {"The export has no saved opponent decks."}
        for(i in 0 until opponents.length()) {
            val opponent=opponents.getJSONObject(i)
            require(opponent.opt("name") is String && opponent.optString("name").isNotBlank() && opponent.opt("text") is String && opponent.optString("text").isNotBlank()) {"The export contains an unreadable opponent name or deck."}
        }
        val results=archive.getJSONArray("results")
        require(results.length()<=10000) {"Too many attempts in one export."}
        for(i in 0 until results.length()) {
            val result=results.getJSONObject(i)
            require(result.optString("engine")=="forge" && result.has("index") && result.optInt("index") in 0 until total && result.optString("termination").isNotBlank()) {"The export contains an invalid game result."}
        }
        payload.put("importedFromRunId",archive.optString("runId")).put("importedAt",java.time.Instant.now().toString())
        val sourceState=archive.optString("state")
        val restoredState=if(sourceState in listOf("complete","failed","cancelled","interrupted")) sourceState else "interrupted"
        val db=writableDatabase
        var id: String?=null;var committed=false
        db.beginTransaction()
        try {
            val imported=create(payload,"importing");id=imported
            for(i in 0 until results.length()) file(imported,"import-${i.toString().padStart(5,'0')}.jsonl").writeText(JSONObject().put("type","result").put("result",results.getJSONObject(i)).toString()+"\n")
            val completed=successfulIndices(imported).size
            update(imported,restoredState,"Imported saved analysis. Engine work has not been started.",completed)
            db.setTransactionSuccessful();committed=true
            return imported
        } finally {
            db.endTransaction()
            if(!committed && id!=null) File(directory,id).deleteRecursively()
        }
    }
    fun export(id: String): String {
        val run = get(id) ?: error("Run not found")
        return JSONObject().put("schemaVersion",1).put("application","MagicTester Android").put("runId",id).put("state",run.state).put("settings",run.payload).put("results",JSONArray(results(id))).toString(2)
    }
}

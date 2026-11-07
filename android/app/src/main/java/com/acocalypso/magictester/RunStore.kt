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
data class Run(val id: String, val state: String, val label: String, val completed: Int, val payload: JSONObject, val liveGame: JSONObject?=null)
class RunStore(context: Context) : SQLiteOpenHelper(context, "runs.db", null, 2) {
    private val directory = File(context.filesDir, "runs").apply { mkdirs() }
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
    fun create(payload: JSONObject): String {
        require(payload.toString().toByteArray().size <= 1000000) { "The frozen deck pool exceeds 1 MB. Select fewer opponents." }
        val id = UUID.randomUUID().toString()
        writableDatabase.insertOrThrow("runs", null, ContentValues().apply { put("id",id);put("state","queued");put("label","Waiting for the local engine");put("payload",payload.toString());put("created",System.currentTimeMillis()) })
        File(directory,id).mkdirs()
        Diagnostics.event("run.queued","Analysis added to the local queue",id,details=JSONObject().put("format",payload.optString("format")).put("games",payload.optInt("games")).put("clockSeconds",payload.optInt("clockSeconds")).put("seed",payload.optInt("seed")))
        RunEvents.changed();return id
    }
    fun next(): Run? = readableDatabase.rawQuery("SELECT id,state,label,completed,payload,live_game FROM runs WHERE state='queued' ORDER BY created,rowid LIMIT 1",null).use { if(it.moveToFirst()) row(it) else null }
    fun update(id: String, state: String, label: String, completed: Int? = null) {
        val db=writableDatabase
        db.beginTransaction()
        try {
            if(state!="running") stopGame(id,state)
            db.update("runs", ContentValues().apply { put("state", state);put("label",label);completed?.let { put("completed",it) } },"id=?",arrayOf(id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        Diagnostics.event("run.$state",label,id,level=if(state=="failed") "ERROR" else "INFO",details=JSONObject().put("completed",completed ?: JSONObject.NULL))
        RunEvents.changed()
    }
    fun recover() {
        val db=writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery("SELECT id,live_game FROM runs WHERE state='running'",null).use { cursor ->
                while(cursor.moveToNext()) {
                    val live=if(cursor.isNull(1)) null else JSONObject(cursor.getString(1))
                    if(live?.optBoolean("active")==true) live.put("active",false).put("estimated",true).put("termination","interrupted")
                    db.update("runs",ContentValues().apply {put("state","interrupted");put("label","Android stopped this run. Resume to continue from saved results.");if(live!=null) put("live_game",live.toString())},"id=?",arrayOf(cursor.getString(0)))
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun gameEvent(id: String, event: JSONObject) {
        val run=get(id) ?: return
        if(run.state!="running") return
        val value=when(event.optString("type")) {
            "game_started" -> JSONObject().put("active",true).put("unitIndex",event.optInt("index")).put("gameIndex",event.optInt("gameIndex")).put("gameSeed",event.optInt("gameSeed"))
                .put("startedAtEpochMs",event.getLong("startedAtEpochMs")).put("startedElapsedMs",event.getLong("startedElapsedMs")).put("clockSeconds",event.getInt("clockSeconds")).put("elapsedMs",0).put("estimated",false)
            "game_finished" -> {
                val current=run.liveGame ?: return
                if(current.optInt("unitIndex")!=event.optInt("index") || current.optInt("gameIndex")!=event.optInt("gameIndex")) return
                JSONObject(current.toString()).put("active",false).put("elapsedMs",event.optLong("durationMs")).put("termination",event.optString("termination")).put("estimated",false)
            }
            else -> return
        }
        writableDatabase.update("runs",ContentValues().apply {put("live_game",value.toString())},"id=? AND state='running'",arrayOf(id))
        RunEvents.changed()
    }
    fun checkpointGame(id: String) {
        val run=get(id) ?: return
        val current=run.liveGame ?: return
        if(run.state!="running" || !current.optBoolean("active")) return
        val original=current.toString()
        val updated=JSONObject(original).put("elapsedMs",GameClock.elapsed(current.optLong("startedElapsedMs"),android.os.SystemClock.elapsedRealtime(),true,current.optLong("elapsedMs")))
        writableDatabase.update("runs",ContentValues().apply {put("live_game",updated.toString())},"id=? AND state='running' AND live_game=?",arrayOf(id,original))
    }
    private fun stopGame(id: String, reason: String) {
        val current=get(id)?.liveGame ?: return
        if(!current.optBoolean("active")) return
        val original=current.toString()
        val value=JSONObject(original).put("active",false).put("termination",reason).put("elapsedMs",GameClock.elapsed(current.optLong("startedElapsedMs"),android.os.SystemClock.elapsedRealtime(),true,current.optLong("elapsedMs")))
        writableDatabase.update("runs",ContentValues().apply {put("live_game",value.toString())},"id=? AND live_game=?",arrayOf(id,original))
    }
    fun resume(id: String, clock: Int) {
        val run = get(id) ?: return
        require(run.state !in listOf("running", "queued", "complete")); require(clock in 5..300)
        val payload = run.payload.put("clockSeconds",clock)
        writableDatabase.update("runs",ContentValues().apply { put("payload",payload.toString());putNull("live_game");put("state","queued");put("label","Resuming unfinished matches") },"id=?",arrayOf(id))
        Diagnostics.event("run.resumed","Unfinished matches requeued",id,details=JSONObject().put("clockSeconds",clock))
        RunEvents.changed()
    }
    fun file(id: String, name: String) = File(File(directory,id),name)
    fun results(id: String): List<JSONObject> = File(directory,id).listFiles().orEmpty().filter { it.name.endsWith(".jsonl") }.sortedBy { it.name }.flatMap { file -> file.useLines { lines -> lines.mapNotNull { line -> try { JSONObject(line).takeIf { it.optString("type") == "result" }?.getJSONObject("result") } catch (_: Exception) { null } }.toList() } }
    fun successfulIndices(id: String) = results(id).filter { it.optString("termination") in listOf("normal", "rule_draw") }.map { it.optInt("index") }.toSet()
    fun export(id: String): String {
        val run = get(id) ?: error("Run not found")
        return JSONObject().put("schemaVersion",1).put("application","MagicTester Android").put("runId",id).put("state",run.state).put("settings",run.payload).put("results",JSONArray(results(id))).toString(2)
    }
}

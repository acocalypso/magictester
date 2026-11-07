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
data class Run(val id: String, val state: String, val label: String, val completed: Int, val payload: JSONObject)
class RunStore(context: Context) : SQLiteOpenHelper(context, "runs.db", null, 1) {
    private val directory = File(context.filesDir, "runs").apply { mkdirs() }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE runs (id TEXT PRIMARY KEY, state TEXT NOT NULL, label TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, created INTEGER NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = error("Unsupported database migration")
    private fun row(c: android.database.Cursor)=Run(c.getString(0),c.getString(1),c.getString(2),c.getInt(3),JSONObject(c.getString(4)))
    fun all(): List<Run> = readableDatabase.rawQuery("SELECT id,state,label,completed,payload FROM runs ORDER BY created DESC,rowid DESC", null).use { c -> buildList { while(c.moveToNext()) add(row(c)) } }
    fun get(id: String): Run? = readableDatabase.rawQuery("SELECT id,state,label,completed,payload FROM runs WHERE id=?",arrayOf(id)).use { if(it.moveToFirst()) row(it) else null }
    fun create(payload: JSONObject): String {
        require(payload.toString().toByteArray().size <= 1000000) { "The frozen deck pool exceeds 1 MB. Select fewer opponents." }
        val id = UUID.randomUUID().toString()
        writableDatabase.insertOrThrow("runs", null, ContentValues().apply { put("id",id);put("state","queued");put("label","Waiting for the local engine");put("payload",payload.toString());put("created",System.currentTimeMillis()) })
        File(directory,id).mkdirs()
        RunEvents.changed();return id
    }
    fun next(): Run? = readableDatabase.rawQuery("SELECT id,state,label,completed,payload FROM runs WHERE state='queued' ORDER BY created,rowid LIMIT 1",null).use { if(it.moveToFirst()) row(it) else null }
    fun update(id: String, state: String, label: String, completed: Int? = null) {
        writableDatabase.update("runs", ContentValues().apply { put("state", state);put("label",label);completed?.let { put("completed",it) } },"id=?",arrayOf(id))
        RunEvents.changed()
    }
    fun recover() { writableDatabase.execSQL("UPDATE runs SET state='interrupted',label='Android stopped this run. Resume to continue from saved results.' WHERE state='running'") }
    fun resume(id: String, clock: Int) {
        val run = get(id) ?: return
        require(run.state !in listOf("running", "queued", "complete")); require(clock in 5..300)
        val payload = run.payload.put("clockSeconds",clock)
        writableDatabase.update("runs",ContentValues().apply { put("payload",payload.toString());put("state","queued");put("label","Resuming unfinished matches") },"id=?",arrayOf(id))
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

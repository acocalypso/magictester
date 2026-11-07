package com.acocalypso.magictester

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class GameTimingStoreTest {
    private fun isolated(): Context {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(base.cacheDir,"timing-${UUID.randomUUID()}").apply { mkdirs() }
        return object: ContextWrapper(base) {
            override fun getFilesDir()=folder
            override fun getDatabasePath(name: String)=File(folder,name)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase = SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name),factory)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?,handler: DatabaseErrorHandler?): SQLiteDatabase = SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path,factory,handler)
        }
    }
    private fun started(game: Int,elapsedStart: Long)=JSONObject().put("type","game_started").put("index",0).put("gameIndex",game).put("gameSeed",37).put("startedAtEpochMs",System.currentTimeMillis()).put("startedElapsedMs",elapsedStart).put("clockSeconds",300)
    @Test fun schemaOneHistorySurvivesUpgradeAndCancellationStopsTheClock() {
        val context=isolated()
        val old=SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath("runs.db"),null)
        try {
            old.execSQL("CREATE TABLE runs(id TEXT PRIMARY KEY,state TEXT NOT NULL,label TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL,created INTEGER NOT NULL)")
            old.execSQL("INSERT INTO runs VALUES('legacy','queued','Waiting',0,?,1)",arrayOf(JSONObject().put("title","Preserved legacy deck").toString()))
            old.version=1
        } finally { old.close() }
        val store=RunStore(context)
        try {
            assertEquals("Preserved legacy deck",store.get("legacy")!!.payload.getString("title"))
            assertNull(store.get("legacy")!!.liveGame)
            store.update("legacy","running","Preparing")
            store.gameEvent("legacy",started(0,SystemClock.elapsedRealtime()-12000))
            store.checkpointGame("legacy")
            assertTrue(store.get("legacy")!!.liveGame!!.getLong("elapsedMs")>=12000)
            store.update("legacy","cancelled","Cancelled")
            val stopped=store.get("legacy")!!.liveGame!!
            assertFalse(stopped.getBoolean("active"))
            assertEquals("cancelled",stopped.getString("termination"))
            val recorded=stopped.getLong("elapsedMs")
            assertEquals(recorded,GameClock.elapsed(stopped.getLong("startedElapsedMs"),SystemClock.elapsedRealtime()+999000,false,recorded))
        } finally { store.close() }
    }
    @Test fun nextGameResetsAndRecoveryKeepsOnlyLastKnownElapsedTime() {
        val store=RunStore(isolated())
        try {
            val id=store.create(JSONObject().put("title","Timing fixture"))
            store.update(id,"running","Preparing")
            store.gameEvent(id,started(0,SystemClock.elapsedRealtime()-20000))
            store.gameEvent(id,JSONObject().put("type","game_finished").put("index",0).put("gameIndex",0).put("durationMs",19000).put("termination","normal"))
            assertEquals(19000,store.get(id)!!.liveGame!!.getLong("elapsedMs"))
            store.gameEvent(id,started(1,SystemClock.elapsedRealtime()-2000))
            assertEquals(0,store.get(id)!!.liveGame!!.getLong("elapsedMs"))
            store.checkpointGame(id)
            val checkpoint=store.get(id)!!.liveGame!!.getLong("elapsedMs")
            store.recover()
            val recovered=store.get(id)!!
            assertEquals("interrupted",recovered.state)
            assertFalse(recovered.liveGame!!.getBoolean("active"))
            assertTrue(recovered.liveGame!!.getBoolean("estimated"))
            assertEquals(checkpoint,recovered.liveGame!!.getLong("elapsedMs"))
            assertEquals(1,recovered.liveGame!!.getInt("gameIndex"))
        } finally { store.close() }
    }
}

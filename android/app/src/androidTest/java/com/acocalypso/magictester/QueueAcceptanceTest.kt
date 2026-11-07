package com.acocalypso.magictester

import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class QueueAcceptanceTest {
    @Test fun twoQueuedAnalysesCompleteAndKeepDecksAndExportableEvidence() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("updates",0).edit().putString("latest",BuildConfig.FORGE_VERSION).putLong("checked",System.currentTimeMillis()).commit()
        ActivityScenario.launch(MainActivity::class.java).use {
            val store=RunStore(context)
            fun payload()=JSONObject().put("title","Queue acceptance").put("deck",Examples.burn).put("format","pauper").put("games",1).put("clockSeconds",120).put("bestOf",1).put("players",2).put("seed",12345).put("engineVersion",BuildConfig.FORGE_VERSION).put("opponents",JSONArray().put(JSONObject().put("name","Reference burn").put("text",Examples.burn)))
            val first=store.create(payload());val second=store.create(payload())
            ContextCompat.startForegroundService(context,Intent(context,QueueService::class.java))
            withTimeout(360000) {
                while(true) {
                    val a=store.get(first)!!;val b=store.get(second)!!
                    assertFalse(a.label,a.state in listOf("failed","interrupted"));assertFalse(b.label,b.state in listOf("failed","interrupted"))
                    if(a.state=="complete" && b.state=="complete") break
                    delay(500)
                }
            }
            for(id in listOf(first,second)) {
                assertEquals(1,store.successfulIndices(id).size)
                val exported=JSONObject(store.export(id))
                assertEquals(Examples.burn,exported.getJSONObject("settings").getString("deck"))
                assertEquals("normal",exported.getJSONArray("results").getJSONObject(0).getString("termination"))
                assertTrue(exported.getJSONArray("results").getJSONObject(0).getJSONObject("actionLog").getJSONArray("entries").length()>20)
                val restored=store.importExport(exported.toString())
                assertNotEquals(id,restored)
                assertEquals("complete",store.get(restored)!!.state)
                assertEquals(exported.getJSONObject("settings").getString("deck"),store.get(restored)!!.payload.getString("deck"))
                assertEquals(exported.getJSONArray("results").toString(),JSONArray(store.results(restored)).toString())
                assertEquals(1,store.get(restored)!!.completed)
            }
            store.close()
        }
    }
}

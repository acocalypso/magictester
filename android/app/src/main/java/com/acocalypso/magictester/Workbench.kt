package com.acocalypso.magictester

import android.app.Application
import android.content.Intent
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

class Workbench(application: Application) : AndroidViewModel(application) {
    private val app get() = getApplication<Application>()
    private val prefs = app.getSharedPreferences("workbench",0)
    val store = RunStore(app)
    val deckLibrary=DeckLibrary(app)
    var savedDecks by mutableStateOf<List<SavedDeckSummary>>(emptyList())
    var savedDeckId by mutableStateOf(prefs.getString("savedDeckId",null))
        private set
    private var loadedSavedDeck by mutableStateOf<SavedDeck?>(null)
    var deckLink by mutableStateOf(prefs.getString("deckLink","") ?: "")
    var deck by mutableStateOf(prefs.getString("deck","") ?: "")
    var title by mutableStateOf(prefs.getString("title","My deck") ?: "My deck")
    var format by mutableStateOf(prefs.getString("format","pauper") ?: "pauper")
    var opponents by mutableStateOf<List<JSONObject>>(emptyList())
    var selected by mutableStateOf<Set<String>>(emptySet())
    var runs by mutableStateOf<List<Run>>(emptyList())
    var performanceVersion by mutableIntStateOf(0)
    var busy by mutableStateOf(false)
    var exportingDiagnostics by mutableStateOf(false)
    var status by mutableStateOf("")
    var fraction by mutableStateOf<Float?>(null)
    var message by mutableStateOf("")
    var firstSetup by mutableStateOf(!prefs.getBoolean("setupReady",false))
    var latest by mutableStateOf(prefs.getString("latest","") ?: "")
    var latestPool by mutableStateOf<JSONObject?>(null)
    init {
        runCatching { MetaJobService.schedule(app) }.onFailure { Diagnostics.event("metadata.schedule_failed","Daily refresh could not be scheduled",level="ERROR",error=it) }
        loadPool()
        viewModelScope.launch {
            try {
                val initialId=savedDeckId
                val saved=withContext(Dispatchers.IO) {initialId?.let {deckLibrary.get(it)}}
                if(savedDeckId==initialId) {
                    loadedSavedDeck=saved
                    if(initialId!=null && saved==null) {savedDeckId=null;saveDraft()}
                }
            } catch(error:Exception) {
                if(error is CancellationException) throw error
                Diagnostics.event("decks.draft_reference_failed","Could not open the draft's saved copy",level="ERROR",error=error)
                message="The saved copy could not be opened. Your current draft is still available."
            }
        }
        viewModelScope.launch {DeckLibraryEvents.changes.collect {
            try {savedDecks=withContext(Dispatchers.IO) {deckLibrary.all()}}
            catch(error:Exception) {Diagnostics.event("decks.read_failed","Could not read saved decks",level="ERROR",error=error);message="The saved deck library could not be opened."}
        }}
        viewModelScope.launch { RunEvents.changes.collect {
            try { runs = withContext(Dispatchers.IO) { store.all() } }
            catch(error:Exception) { Diagnostics.event("database.read_failed","History could not be read",level="ERROR",error=error);message="Local history could not be opened. Export diagnostic logs from Setup for details." }
        } }
        viewModelScope.launch { try { latest = withContext(Dispatchers.IO) { ForgeRelease.check(app) } } catch(_:Exception) { } }
    }
    fun markNotificationPrompted(): Boolean {
        if(prefs.getBoolean("notificationPrompted",false)) return false
        prefs.edit().putBoolean("notificationPrompted",true).apply();return true
    }
    fun saveDraft() { prefs.edit().putString("deck",deck).putString("title",title).putString("format",format).putString("deckLink",deckLink).putString("savedDeckId",savedDeckId).apply() }
    fun chooseFormat(value: String) { format=value;saveDraft();loadPool() }
    fun loadPool() {
        latestPool = Metagame(app).cached(format)
        val custom = try { JSONArray(prefs.getString("pool-$format","[]")) } catch(_:Exception) { JSONArray() }
        val meta = latestPool?.optJSONArray("decks") ?: JSONArray()
        opponents = (0 until custom.length()).map { custom.getJSONObject(it) } + (0 until meta.length()).map { meta.getJSONObject(it) }
        selected = opponents.map { it.getString("name") }.toSet()
    }
    private fun launchWork(block: suspend () -> Unit) {
        if(busy) return
        busy=true;message="";fraction=null
        viewModelScope.launch {
            try { block() } catch(error:Throwable) { if(error is CancellationException) throw error; Diagnostics.event("operation.failed",error.message ?: "Operation failed",level="ERROR",error=error); message=error.message ?: "The operation failed." }
            finally { busy=false;fraction=null }
        }
    }
    val hasUnsavedDeck: Boolean get() {
        val saved=loadedSavedDeck
        return deck.isNotBlank() && (saved==null || title.trim()!=saved.name || format!=saved.format || deck!=saved.text || deckLink!=saved.sourceUrl)
    }
    fun useDeckFile(text: String) {savedDeckId=null;loadedSavedDeck=null;deckLink="";deck=text;saveDraft()}
    fun newDeck() {savedDeckId=null;loadedSavedDeck=null;title="My deck";deck="";deckLink="";saveDraft()}
    fun loadReference() {newDeck();deck=if(DeckText.commander(format)) Examples.commander() else Examples.burn;title="Local reference";saveDraft()}
    fun saveDeck(asNew: Boolean=false) = launchWork {
        status="Saving deck on this device"
        val id=if(asNew) null else savedDeckId
        val name=title;val selectedFormat=format;val text=deck;val link=deckLink
        val saved=withContext(Dispatchers.IO) {deckLibrary.save(id,name,selectedFormat,text,link)}
        savedDeckId=saved.id;loadedSavedDeck=saved;saveDraft()
        message="Saved ${saved.name} locally. Legality is checked when you choose Check deck or start an analysis."
    }
    fun loadSavedDeck(id: String) = launchWork {
        status="Loading saved deck"
        val saved=withContext(Dispatchers.IO) {deckLibrary.get(id)} ?: error("Saved deck not found.")
        savedDeckId=saved.id;loadedSavedDeck=saved;title=saved.name;format=saved.format;deck=saved.text;deckLink=saved.sourceUrl
        saveDraft();loadPool();message="Loaded ${saved.name}. No analysis has been started."
    }
    fun renameSavedDeck(id: String,name: String) = launchWork {
        status="Renaming saved deck"
        val old=withContext(Dispatchers.IO) {deckLibrary.get(id)} ?: error("Saved deck not found.")
        val saved=withContext(Dispatchers.IO) {deckLibrary.rename(id,name)}
        if(savedDeckId==id) {if(title==old.name) title=saved.name;loadedSavedDeck=saved;saveDraft()}
        message="Renamed saved deck to ${saved.name}."
    }
    fun deleteSavedDeck(id: String) = launchWork {
        status="Removing saved copy"
        withContext(Dispatchers.IO) {deckLibrary.delete(id)}
        if(savedDeckId==id) {savedDeckId=null;loadedSavedDeck=null;saveDraft()}
        message="Saved copy removed. Your current draft and analysis history are kept."
    }
    fun setup() = launchWork {
        Diagnostics.event("setup.started","Local engine setup requested", "setup")
        status="Preparing on-device engine"
        val result = ForgeClient.execute(app,JSONObject().put("operation","setup"),"setup") { label,value -> status=label;fraction=value }
        check(JSONObject(withContext(Dispatchers.IO) { result.readText() }).getBoolean("ready"))
        Diagnostics.event("setup.complete","Local engine setup completed", "setup")
        prefs.edit().putBoolean("setupReady",true).apply();firstSetup=false;message="Forge is installed and initialized. Import your deck and add opponents to begin."
        withContext(Dispatchers.IO) { result.delete() }
    }
    fun validate() = launchWork {
        val checkedDeck=deck;val checkedFormat=format
        saveDraft();status="Checking deck structure and current legality"
        val parsed=DeckText.parse(checkedDeck);require(parsed.errors.isEmpty()) { parsed.errors.joinToString("\n") }
        val source=withContext(Dispatchers.IO) { CurrentLegality(app).check(listOf(checkedDeck),checkedFormat) { status=it } }
        val file=ForgeClient.execute(app,JSONObject().put("operation","validate").put("text",checkedDeck).put("format",checkedFormat),"validation") { label,value -> status=label;fraction=value }
        val result=JSONObject(withContext(Dispatchers.IO) { file.readText() })
        withContext(Dispatchers.IO) { file.delete() }
        val errors=result.getJSONArray("errors")
        if(deck != checkedDeck || format != checkedFormat) { message="Your draft changed during the check. Check the current text again before using the result.";return@launchWork }
        message=if(result.getBoolean("valid")) "Deck passed: card support, deck size, copy limits, format rules and commander pairing/color identity. $source." else (0 until errors.length()).joinToString("\n") { errors.getString(it) }
    }
    fun importLink(link: String, opponent: Boolean = false) = launchWork {
        status="Importing public deck"
        val (name,text)=withContext(Dispatchers.IO) { DeckLinks.load(link) }
        if(opponent) addOpponent(name,text) else { savedDeckId=null;loadedSavedDeck=null;title=name;deck=text;deckLink=link.trim();saveDraft() }
        message="Imported $name. Review its commander and companion sections before testing."
    }
    fun addOpponent(name: String, text: String) {
        val parsed=DeckText.parse(text);require(parsed.errors.isEmpty()) { parsed.errors.joinToString("\n") }
        val custom=JSONArray(prefs.getString("pool-$format","[]"))
        require(custom.length() < 30) { "A custom pool supports up to 30 decks." }
        custom.put(JSONObject().put("name",name.ifBlank { "Opponent ${custom.length()+1}" }).put("text",text).put("source","Custom text"))
        prefs.edit().putString("pool-$format",custom.toString()).apply();loadPool()
    }
    fun clearCustom() { prefs.edit().remove("pool-$format").apply();loadPool() }
    fun refreshMeta() = launchWork {
        withContext(Dispatchers.IO) { Metagame(app).refresh(format,true) { status=it } }
        loadPool();message="Opponent pool refreshed. Select the decks you want to test against."
    }
    fun enqueue(games: Int, clock: Int, bestOf: Int, players: Int, seed: Int) = launchWork {
        require(games in 1..100 && clock in 5..300 && players in 2..4)
        val submittedDeck=deck;val submittedTitle=title;val submittedFormat=format
        val chosen=opponents.filter { it.getString("name") in selected }.map { JSONObject(it.toString()) }
        require(chosen.isNotEmpty()) { "Add and select an opponent deck in Pools." }
        require(DeckText.parse(submittedDeck).errors.isEmpty()) { DeckText.parse(submittedDeck).errors.joinToString("\n") }
        status="Verifying stable Forge and current legality"
        val legality=withContext(Dispatchers.IO) { ForgeRelease.requireCurrent(app);CurrentLegality(app).check(listOf(submittedDeck)+chosen.map { it.getString("text") },submittedFormat) { status=it } }
        saveDraft()
        val payload=JSONObject().put("title",submittedTitle).put("deck",submittedDeck).put("format",submittedFormat).put("games",games).put("clockSeconds",clock)
            .put("bestOf",if(DeckText.commander(submittedFormat)) 1 else bestOf).put("players",players).put("seed",seed).put("engineVersion",BuildConfig.FORGE_VERSION)
            .put("opponents",JSONArray(chosen)).put("legality",legality).put("createdAt",java.time.Instant.now().toString())
        withContext(Dispatchers.IO) { store.create(payload) };startQueue();message="Analysis queued. Follow it in Runs; completed evidence is saved after every match."
    }
    fun importAnalyses(uris: List<android.net.Uri>) = launchWork {
        require(uris.size in 1..100) {"Choose up to 100 analysis JSON exports at a time."}
        var imported=0;var draft: JSONObject?=null
        val errors=mutableListOf<String>()
        for((index,uri) in uris.withIndex()) {
            status="Restoring saved analysis ${index+1}/${uris.size}"
            try {
                val payload=withContext(Dispatchers.IO) {
                    val bytes=app.contentResolver.openInputStream(uri)?.use {input ->
                        val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(32768)
                        while(true) {val count=input.read(buffer);if(count<0) break;require(output.size()+count<=32*1024*1024) {"Analysis export exceeds the 32 MiB import limit."};output.write(buffer,0,count)}
                        output.toString("UTF-8")
                    } ?: error("Could not open the selected export.")
                    store.get(store.importExport(bytes))!!.payload
                }
                draft=payload;imported++
            } catch(error:Exception) {
                if(error is CancellationException) throw error
                errors+="File ${index+1}: ${error.message ?: "Import failed"}"
                Diagnostics.event("run.import_failed","Could not restore a selected analysis export",level="ERROR",error=error)
            }
        }
        if(deck.isBlank()) draft?.let {payload ->savedDeckId=null;loadedSavedDeck=null;deckLink="";deck=payload.getString("deck");title=payload.optString("title","My deck");format=payload.getString("format");saveDraft();loadPool()}
        message="Restored $imported analysis exports. Open Runs to inspect them. No games were started."+if(errors.isEmpty()) "" else "\n"+errors.joinToString("\n")
    }
    fun exportDiagnostics(uri: android.net.Uri, runId: String?, includeDecklists: Boolean) {
        if(exportingDiagnostics) return
        exportingDiagnostics=true
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val stream=app.contentResolver.openOutputStream(uri) ?: error("Could not open the selected destination")
                    stream.use { DiagnosticExporter.write(app,it,runId,includeDecklists) }
                }
                message="Diagnostic ZIP saved. Open summary.txt first; errors and engine traces are included."
            } catch(error:Exception) { Diagnostics.event("diagnostics.failed","Could not save diagnostic ZIP",runId,level="ERROR",error=error);message=error.message ?: "Diagnostic export failed." }
            finally { exportingDiagnostics=false }
        }
    }
    fun benchmark(useCurrent: Boolean,players: Int) = launchWork {
        val benchmarkFormat=if(useCurrent) format else "pauper"
        val benchmarkDeck=if(useCurrent) deck else Examples.burn
        val benchmarkName=if(useCurrent) title.ifBlank { "Untitled deck" } else "Reference burn"
        val chosen=if(useCurrent) opponents.filter {it.getString("name") in selected}.map {JSONObject(it.toString())} else listOf(JSONObject().put("name","Reference burn").put("text",Examples.burn))
        require(chosen.isNotEmpty()) {"Select opponent decks in Pools first."}
        val workloads=listOf("Your deck ‘$benchmarkName’" to benchmarkDeck)+chosen.map { "Opponent ‘${it.getString("name")}’" to it.getString("text") }
        for((label,text) in workloads) {
            val problems=BenchmarkDeckCheck.problems(text,benchmarkFormat)
            require(problems.isEmpty()) { "$label · $benchmarkFormat\n${problems.joinToString("\n")}\nCheck the selected format and deck in Test, and opponents in Pools. No performance test was queued." }
        }
        status="Checking benchmark deck structure"
        // One disposable engine initializes Forge once for the whole frozen workload.
        val texts=workloads.map {it.second}.distinct()
        val validationFile=ForgeClient.execute(app,JSONObject().put("operation","validate").put("texts",JSONArray(texts)).put("format",benchmarkFormat),"validation") {label,value -> status=label;fraction=value}
        val results=withContext(Dispatchers.IO) {try {JSONObject(validationFile.readText()).getJSONArray("results")} finally {validationFile.delete()}}
        for((label,text) in workloads) {
            val result=results.getJSONObject(texts.indexOf(text))
            require(result.getBoolean("valid")) {
                val errors=result.getJSONArray("errors")
                "$label · $benchmarkFormat\n"+(0 until errors.length()).joinToString("\n") {errors.getString(it)}+"\nNo performance test was queued. Correct the deck or selected format first."
            }
        }
        status="Checking the benchmark workload"
        val legality=withContext(Dispatchers.IO) {ForgeRelease.requireCurrent(app);CurrentLegality(app).check(listOf(benchmarkDeck)+chosen.map {it.getString("text")},benchmarkFormat) {status=it}}
        val payload=JSONObject().put("kind","benchmark").put("title","Device performance test").put("deck",benchmarkDeck).put("format",benchmarkFormat).put("games",20).put("clockSeconds",if(DeckText.commander(benchmarkFormat)) 300 else 120).put("bestOf",1).put("players",if(benchmarkFormat=="duel") 2 else players).put("seed",24681357).put("engineVersion",BuildConfig.FORGE_VERSION).put("opponents",JSONArray(chosen)).put("legality",legality)
        withContext(Dispatchers.IO) {store.create(payload)};startQueue();message="Performance test queued. Follow its real games in Runs; settings update after each measured stage."
    }
    fun deleteRun(id: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                store.get(id)?.let { store.update(id,"deleting","Removing analysis") }
                ForgeClient.cancel(id)
                store.delete(id)
            } catch(error:Exception) { Diagnostics.event("run.delete_failed","Analysis could not be deleted",id,level="ERROR",error=error);withContext(Dispatchers.Main) { message=error.message ?: "Could not remove this analysis." } }
        }
    }
    fun startQueue() { ContextCompat.startForegroundService(app,Intent(app,QueueService::class.java)) }
    fun cancel(id: String) { ContextCompat.startForegroundService(app,Intent(app,QueueService::class.java).setAction("cancel").putExtra("id",id)) }
    fun resume(id: String, timeout: Int) { store.resume(id,timeout);startQueue() }
    override fun onCleared() { ForgeClient.cancel("setup");ForgeClient.cancel("validation");deckLibrary.close();super.onCleared() }
}

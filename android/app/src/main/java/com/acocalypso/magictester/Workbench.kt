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
    var deck by mutableStateOf(prefs.getString("deck","") ?: "")
    var title by mutableStateOf(prefs.getString("title","My deck") ?: "My deck")
    var format by mutableStateOf(prefs.getString("format","pauper") ?: "pauper")
    var opponents by mutableStateOf<List<JSONObject>>(emptyList())
    var selected by mutableStateOf<Set<String>>(emptySet())
    var runs by mutableStateOf<List<Run>>(emptyList())
    var busy by mutableStateOf(false)
    var status by mutableStateOf("")
    var fraction by mutableStateOf<Float?>(null)
    var message by mutableStateOf("")
    var firstSetup by mutableStateOf(!prefs.getBoolean("setupReady",false))
    var latest by mutableStateOf(prefs.getString("latest","") ?: "")
    var latestPool by mutableStateOf<JSONObject?>(null)
    init {
        MetaJobService.schedule(app); loadPool()
        viewModelScope.launch { while(isActive) { runs = withContext(Dispatchers.IO) { store.all() };delay(1000) } }
        viewModelScope.launch { try { latest = withContext(Dispatchers.IO) { ForgeRelease.check(app) } } catch(_:Exception) { } }
    }
    fun saveDraft() { prefs.edit().putString("deck",deck).putString("title",title).putString("format",format).apply() }
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
            try { block() } catch(error:Throwable) { if(error is CancellationException) throw error; message=error.message ?: "The operation failed." }
            finally { busy=false;fraction=null }
        }
    }
    fun setup() = launchWork {
        status="Preparing on-device engine"
        val result = ForgeClient.execute(app,JSONObject().put("operation","setup"),"setup") { label,value -> status=label;fraction=value }
        check(JSONObject(withContext(Dispatchers.IO) { result.readText() }).getBoolean("ready"))
        prefs.edit().putBoolean("setupReady",true).apply();firstSetup=false;message="Forge is installed and initialized. Import your deck and add opponents to begin."
        withContext(Dispatchers.IO) { result.delete() }
    }
    fun validate() = launchWork {
        saveDraft();status="Checking deck structure and current legality"
        val parsed=DeckText.parse(deck);require(parsed.errors.isEmpty()) { parsed.errors.joinToString("\n") }
        val source=withContext(Dispatchers.IO) { CurrentLegality(app).check(listOf(deck),format) { status=it } }
        val file=ForgeClient.execute(app,JSONObject().put("operation","validate").put("text",deck).put("format",format),"validation") { label,value -> status=label;fraction=value }
        val result=JSONObject(withContext(Dispatchers.IO) { file.readText() })
        val errors=result.getJSONArray("errors")
        message=if(result.getBoolean("valid")) "Deck passed: card support, deck size, copy limits, format rules and commander pairing/color identity. $source." else (0 until errors.length()).joinToString("\n") { errors.getString(it) }
    }
    fun importLink(link: String, opponent: Boolean = false) = launchWork {
        status="Importing public deck"
        val (name,text)=withContext(Dispatchers.IO) { DeckLinks.load(link) }
        if(opponent) addOpponent(name,text) else { title=name;deck=text;saveDraft() }
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
        val chosen=opponents.filter { it.getString("name") in selected }
        require(chosen.isNotEmpty()) { "Add and select an opponent deck in Pools." }
        require(DeckText.parse(deck).errors.isEmpty()) { DeckText.parse(deck).errors.joinToString("\n") }
        status="Verifying stable Forge and current legality"
        val legality=withContext(Dispatchers.IO) { ForgeRelease.requireCurrent(app);CurrentLegality(app).check(listOf(deck)+chosen.map { it.getString("text") },format) { status=it } }
        saveDraft()
        val payload=JSONObject().put("title",title).put("deck",deck).put("format",format).put("games",games).put("clockSeconds",clock)
            .put("bestOf",if(DeckText.commander(format)) 1 else bestOf).put("players",players).put("seed",seed).put("engineVersion",BuildConfig.FORGE_VERSION)
            .put("opponents",JSONArray(chosen)).put("legality",legality).put("createdAt",java.time.Instant.now().toString())
        withContext(Dispatchers.IO) { store.create(payload) };startQueue();message="Analysis queued. Follow it in Runs; completed evidence is saved after every match."
    }
    fun startQueue() { ContextCompat.startForegroundService(app,Intent(app,QueueService::class.java)) }
    fun cancel(id: String) { ContextCompat.startForegroundService(app,Intent(app,QueueService::class.java).setAction("cancel").putExtra("id",id)) }
    fun resume(id: String, timeout: Int) { store.resume(id,timeout);startQueue() }
    override fun onCleared() { ForgeClient.cancel("setup");ForgeClient.cancel("validation");super.onCleared() }
}

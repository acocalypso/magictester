package com.acocalypso.magictester

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

private val charcoal = Color(0xFF141719)
private val paper = Color(0xFFF2F2EE)
private val accent = Color(0xFFB3CAD7)
private val palette = darkColorScheme(primary=accent,onPrimary=charcoal,secondary=accent,onSecondary=charcoal,secondaryContainer=Color(0xFF2A3941),onSecondaryContainer=paper,tertiary=accent,onTertiary=charcoal,outlineVariant=Color(0xFF3D464C),background=charcoal,onBackground=paper,surface=Color(0xFF1E2225),onSurface=paper,surfaceVariant=Color(0xFF292F33),onSurfaceVariant=Color(0xFFB3B9BC),outline=Color(0xFF596269),error=Color(0xFFFFB4AB))
private data class DiagnosticRequest(val runId: String?)
class MainActivity : ComponentActivity() {
    private val model: Workbench by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme=palette) { Surface(Modifier.fillMaxSize()) { WorkbenchApp(model) } } }
    }
}
@Composable private fun WorkbenchApp(model: Workbench) {
    var tab by remember { mutableIntStateOf(if(model.firstSetup) 3 else 0) }
    var deletingRun by remember { mutableStateOf<String?>(null) }
    var selectedRun by remember { mutableStateOf<String?>(null) }
    val tabHistory=remember {mutableStateListOf<Int>()}
    fun navigateTab(next: Int) {
        if(next!=tab) {if(tabHistory.size>=20) tabHistory.removeAt(0);tabHistory.add(tab);tab=next}
        selectedRun=null
    }
    BackHandler(enabled=(tab==1 && selectedRun!=null) || tabHistory.isNotEmpty()) {
        if(tab==1 && selectedRun!=null) selectedRun=null else tab=tabHistory.removeAt(tabHistory.lastIndex)
    }
    var deckDialog by remember { mutableStateOf<Pair<String,String>?>(null) }
    var exportRun by remember { mutableStateOf<String?>(null) }
    var diagnosticRequest by remember { mutableStateOf<DiagnosticRequest?>(null) }
    var includeDiagnosticDecks by remember { mutableStateOf(false) }
    var pendingDiagnosticRun by remember { mutableStateOf<String?>(null) }
    var pendingDiagnosticDecks by remember { mutableStateOf(false) }
    val context=androidx.compose.ui.platform.LocalContext.current
    val scope=rememberCoroutineScope()
    val notification=androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val open=androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if(uri != null) scope.launchIO(model) { val text=context.contentResolver.openInputStream(uri)!!.use { input -> val buffer=ByteArray(200001);var used=0;while(used<buffer.size) { val n=input.read(buffer,used,buffer.size-used);if(n<0) break;used+=n };require(used<=200000) { "Deck file exceeds 200 KB" };String(buffer,0,used,Charsets.UTF_8) }; withContext(Dispatchers.Main) { model.deck=text;model.saveDraft() } }
    }
    val export=androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val id=exportRun
        if(uri != null && id != null) scope.launchIO(model) { context.contentResolver.openOutputStream(uri)!!.bufferedWriter().use { it.write(model.store.export(id)) } }
    }
    val restoreRuns=androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if(uris.isNotEmpty()) model.importAnalyses(uris) }
    val exportLogs=androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if(uri!=null) model.exportDiagnostics(uri,pendingDiagnosticRun,pendingDiagnosticDecks)
    }
    LaunchedEffect(Unit) { if(Build.VERSION.SDK_INT >= 33) notification.launch(Manifest.permission.POST_NOTIFICATIONS) }
    Scaffold(containerColor=charcoal,bottomBar={ NavigationBar(containerColor=charcoal,tonalElevation=0.dp) {
        listOf("Test","Runs","Pools","Setup").forEachIndexed { index,label -> NavigationBarItem(selected=tab==index,onClick={navigateTab(index)},icon={Text(listOf("＋","≡","▤","○")[index],fontSize=24.sp)},label={Text(label)}) }
    } }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal=22.dp,vertical=14.dp),verticalAlignment=Alignment.CenterVertically) {
                Text("MT",Modifier.border(1.dp,accent,RoundedCornerShape(3.dp)).padding(7.dp),fontFamily=FontFamily.Monospace,fontWeight=FontWeight.Bold,color=accent)
                Spacer(Modifier.width(12.dp));Column { Text("MagicTester",fontSize=21.sp,fontWeight=FontWeight.SemiBold);Text("ON-DEVICE WORKBENCH",fontSize=10.sp,letterSpacing=2.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                Spacer(Modifier.weight(1f));Text("Forge\n${BuildConfig.FORGE_VERSION}",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider(color=MaterialTheme.colorScheme.surfaceVariant)
            if(model.busy || model.exportingDiagnostics) Column(Modifier.padding(horizontal=22.dp,vertical=10.dp)) { Text(if(model.exportingDiagnostics) "Collecting diagnostic logs" else model.status,fontSize=12.sp);Spacer(Modifier.height(8.dp));if(model.exportingDiagnostics || model.fraction == null) LinearProgressIndicator(Modifier.fillMaxWidth()) else LinearProgressIndicator(progress={model.fraction ?: 0f},modifier=Modifier.fillMaxWidth()) }
            if(model.message.isNotEmpty()) Surface(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=6.dp),color=MaterialTheme.colorScheme.surfaceVariant,shape=RoundedCornerShape(8.dp)) { Row(Modifier.padding(12.dp)) { Text(model.message,Modifier.weight(1f).heightIn(max=180.dp).verticalScroll(rememberScrollState()),fontSize=13.sp);TextButton(onClick={model.message=""}) { Text("×") } } }
            when(tab) {
                0 -> TestScreen(model,{ open.launch(arrayOf("text/*","application/octet-stream")) },{navigateTab(2)})
                1 -> if(selectedRun == null) RunsScreen(model,{selectedRun=it},{deletingRun=it}) else RunDetail(model,selectedRun!!,{selectedRun=null},{deckDialog=it},{exportRun=it;export.launch("magictester-$it.json")},{includeDiagnosticDecks=false;diagnosticRequest=DiagnosticRequest(it)},{deletingRun=it})
                2 -> PoolsScreen(model) { deckDialog=it }
                else -> SetupScreen(model,diagnostics={ includeDiagnosticDecks=false;diagnosticRequest=DiagnosticRequest(null) },restore={restoreRuns.launch(arrayOf("application/json","text/plain","application/octet-stream"))})
            }
        }
    }
    deletingRun?.let { id -> AlertDialog(onDismissRequest={deletingRun=null},title={Text("Delete analysis?")},text={Text("This stops its active games and deletes its saved results and decklists. Export anything you want to keep first.")},confirmButton={TextButton(onClick={model.deleteRun(id);if(selectedRun==id) selectedRun=null;deletingRun=null}) {Text("Delete")}},dismissButton={TextButton(onClick={deletingRun=null}) {Text("Keep")}}) }
    diagnosticRequest?.let { request ->
        AlertDialog(onDismissRequest={diagnosticRequest=null},title={Text("Export diagnostic logs")},text={Column {
            Text(if(request.runId==null) "Save startup, setup and recent run diagnostics." else "Save the selected run's settings, errors and engine evidence.")
            Spacer(Modifier.height(12.dp))
            Text("Includes device/resource information, error traces and game actions, which may contain card names. Complete decklists are optional.",fontSize=13.sp)
            Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(includeDiagnosticDecks,{includeDiagnosticDecks=it});Text("Include complete decklists",fontSize=13.sp) }
        }},confirmButton={TextButton(onClick={pendingDiagnosticRun=request.runId;pendingDiagnosticDecks=includeDiagnosticDecks;diagnosticRequest=null;exportLogs.launch("MagicTester-diagnostics-${System.currentTimeMillis()}.zip")},enabled=!model.exportingDiagnostics) {Text("Save ZIP")}},dismissButton={TextButton(onClick={diagnosticRequest=null}) {Text("Cancel")}})
    }
    deckDialog?.let { (title,text) -> AlertDialog(onDismissRequest={deckDialog=null},title={Text(title)},text={Box(Modifier.heightIn(max=500.dp).verticalScroll(rememberScrollState())) { Text(text,fontFamily=FontFamily.Monospace,fontSize=13.sp) }},confirmButton={TextButton(onClick={deckDialog=null}) {Text("Close")}}) }
}
private fun kotlinx.coroutines.CoroutineScope.launchIO(model: Workbench, block: suspend () -> Unit) = this.launch(context=Dispatchers.IO) { try { block() } catch(error:Exception) { withContext(Dispatchers.Main) { model.message=error.message ?: "The operation failed." } } }
@Composable private fun PageTitle(kicker: String, title: String, description: String) { Column { Text(kicker.uppercase(),color=accent,fontSize=10.sp,letterSpacing=2.sp);Spacer(Modifier.height(8.dp));Text(title,fontSize=30.sp,fontWeight=FontWeight.Medium,lineHeight=34.sp);Spacer(Modifier.height(8.dp));Text(description,color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=14.sp,lineHeight=20.sp) } }
@Composable private fun FormatPicker(model: Workbench) { var expanded by remember { mutableStateOf(false) };Box { OutlinedButton(onClick={expanded=true},enabled=!model.busy) { Text("Format: ${model.format.replaceFirstChar { it.uppercase() }} ▾") };DropdownMenu(expanded,onDismissRequest={expanded=false}) { DeckText.formats.forEach { format -> DropdownMenuItem(text={Text(format)},onClick={model.chooseFormat(format);expanded=false}) } } } }
@Composable private fun TestScreen(model: Workbench, open: () -> Unit, pools: () -> Unit) {
    var link by remember { mutableStateOf("") };var games by remember { mutableIntStateOf(10) };var timeout by remember { mutableIntStateOf(if(DeckText.commander(model.format)) 300 else 120) };var bestOf by remember { mutableStateOf(false) };var players by remember { mutableIntStateOf(4) };var seed by remember { mutableStateOf("12345") }
    LaunchedEffect(model.format) { timeout=if(DeckText.commander(model.format)) 300 else 120 }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        PageTitle("01 / Prepare","Put your deck\nto the test.","Real Forge AI games, saved locally. Compare your list with selected opponents and inspect every recorded turn.")
        FormatPicker(model)
        OutlinedTextField(model.title,{model.title=it;model.saveDraft()},label={Text("Deck name")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        OutlinedTextField(link,{link=it},label={Text("Moxfield or Archidekt link")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        OutlinedButton(onClick={model.importLink(link)},enabled=!model.busy && link.isNotBlank()) {Text("Import public deck")}
        if(DeckText.commander(model.format)) Text("Place both eligible commanders under a Commander heading. Use Deck for the other cards. A legal pair counts toward the 100-card total.",fontSize=13.sp,color=accent)
        OutlinedTextField(model.deck,{model.deck=it;model.saveDraft()},label={Text("Decklist")},modifier=Modifier.fillMaxWidth().heightIn(min=230.dp,max=420.dp),textStyle=LocalTextStyle.current.copy(fontFamily=FontFamily.Monospace,fontSize=13.sp))
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) { OutlinedButton(onClick=open) { Text("Open file") };OutlinedButton(onClick={model.validate()},enabled=!model.busy && model.deck.isNotBlank()) {Text("Check deck")} }
        TextButton(onClick={model.deck=if(DeckText.commander(model.format)) Examples.commander() else Examples.burn;model.title="Local reference";model.saveDraft()}) {Text("Load reference deck")}
        HorizontalDivider()
        Text("Analysis settings",fontSize=19.sp)
        Text("$games matches · ${if(bestOf && !DeckText.commander(model.format)) "best of three" else "single games"}")
        Slider(games.toFloat(),{games=it.toInt().coerceIn(1,100)},valueRange=1f..100f,steps=98)
        Text("Game timeout: $timeout seconds")
        Slider(timeout.toFloat(),{timeout=(it.toInt()/5*5).coerceIn(5,300)},valueRange=5f..300f,steps=58)
        if(!DeckText.commander(model.format)) Row(verticalAlignment=Alignment.CenterVertically) { Switch(bestOf,{bestOf=it});Spacer(Modifier.width(10.dp));Text("Best of three · native AI sideboarding") }
        if(model.format in listOf("commander","cedh")) { Text("Commander table: $players players");Slider(players.toFloat(),{players=it.toInt()},valueRange=2f..4f,steps=1) }
        OutlinedTextField(seed,{seed=it.filter(Char::isDigit).take(10)},label={Text("Random seed")},supportingText={Text("Saved with the run for reproducibility.")},singleLine=true,modifier=Modifier.fillMaxWidth())
        Text("${model.selected.size} opponent decks selected. Opponents rotate equally across matches; this is a selected-pool comparison, not a metagame-weighted win rate.",fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick=pools) { Text("Choose opponents →") }
        Button(onClick={model.enqueue(games,timeout,if(bestOf) 3 else 1,players,seed.toIntOrNull() ?: 12345)},enabled=!model.busy && !model.firstSetup && model.deck.isNotBlank() && model.selected.isNotEmpty(),modifier=Modifier.fillMaxWidth().height(52.dp),shape=RoundedCornerShape(6.dp)) { Text("Queue analysis") }
        Text("How it works: current legality and Forge card support are checked first. Forge then pilots every seat. A timeout is shown as unfinished evidence and never counted as a loss. AI results estimate matchup behavior; they do not predict human tournament performance.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable private fun RunsScreen(model: Workbench, select: (String) -> Unit, delete: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(22.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        item { PageTitle("02 / Observe","Your analyses","Queue progress, recorded outcomes, and the evidence behind each result.") }
        if(model.runs.isEmpty()) item { Text("No analyses yet. Add a deck and opponents, then queue your first run.",Modifier.padding(vertical=24.dp)) }
        items(model.runs,key={it.id}) { run -> OutlinedCard(onClick={select(run.id)},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(8.dp)) {
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) { Row { Text(run.payload.optString("title","My deck"),Modifier.weight(1f),fontWeight=FontWeight.SemiBold);Text(run.state.uppercase(),fontSize=10.sp,color=accent) };Text("${run.payload.optString("format")} · ${run.completed}/${run.payload.optInt("games")} matches",fontSize=13.sp);LinearProgressIndicator(progress={run.completed.toFloat()/run.payload.optInt("games",1)},modifier=Modifier.fillMaxWidth());Text(run.label,fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);if(run.liveGame!=null) LiveGamePanel(run,true);TextButton(onClick={delete(run.id)}) {Text("Delete analysis")} }
        } }
    }
}
@Composable private fun PoolsScreen(model: Workbench, show: (Pair<String,String>) -> Unit) {
    var link by remember { mutableStateOf("") };var name by remember { mutableStateOf("") };var text by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        PageTitle("03 / Compare","Opponent pools","Choose the exact decks your list will face. Every analysis keeps its own immutable copy.")
        FormatPicker(model)
        OutlinedButton(onClick={model.refreshMeta()},enabled=!model.busy) { Text("Refresh daily metagame") }
        model.latestPool?.let { pool -> Text("${pool.optString("scope")}\nFetched ${DateFormat.getDateTimeInstance().format(Date(pool.optLong("fetchedAt")))}. Source: MTGTop8.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        model.latestPool?.let { pool ->
            val count=pool.optJSONArray("decks")?.length() ?: 0
            Text("Current metagame: $count / ${Metagame.TARGET_DECKS} decks",fontSize=13.sp,color=accent)
            if(count<Metagame.TARGET_DECKS) Text(if(pool.optInt("targetDeckCount")!=Metagame.TARGET_DECKS) "Refresh the metagame to replace this older cache with the ten-deck pool." else "The source supplied only $count complete decklists. Refresh later to try again; incomplete or invented lists are not added.",fontSize=12.sp,color=MaterialTheme.colorScheme.error)
        }
        Text("Android schedules a refresh for all formats daily. The OS may delay it; the fetched date always shows the age of the cached pool.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        model.opponents.forEach { opponent -> val title=opponent.getString("name");OutlinedCard(Modifier.fillMaxWidth(),shape=RoundedCornerShape(6.dp)) { Row(Modifier.padding(10.dp),verticalAlignment=Alignment.CenterVertically) { Checkbox(title in model.selected,{checked -> model.selected=if(checked) model.selected+title else model.selected-title});Column(Modifier.weight(1f)) {Text(title);if(opponent.has("share")) Text("${"%.1f".format(opponent.optDouble("share")*100)}% source share",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)};TextButton(onClick={show(title to opponent.getString("text"))}) {Text("Deck")} } } }
        TextButton(onClick={try {model.addOpponent("Local reference · not tournament data",if(DeckText.commander(model.format)) Examples.commander("Ambassador Laquatus") else Examples.burn)} catch(e:Exception) {model.message=e.message ?: "Could not add reference"}}) {Text("Add local reference opponent")}
        HorizontalDivider();Text("Add your own opponent",fontSize=19.sp)
        OutlinedTextField(link,{link=it},label={Text("Public deck link")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        OutlinedButton(onClick={model.importLink(link,true)},enabled=!model.busy && link.isNotBlank()) {Text("Import opponent")}
        OutlinedTextField(name,{name=it},label={Text("Opponent name")},modifier=Modifier.fillMaxWidth())
        OutlinedTextField(text,{text=it},label={Text("Or paste an opponent decklist")},modifier=Modifier.fillMaxWidth().heightIn(min=160.dp,max=300.dp),textStyle=LocalTextStyle.current.copy(fontFamily=FontFamily.Monospace,fontSize=12.sp))
        OutlinedButton(onClick={try {model.addOpponent(name,text);text="";name=""} catch(e:Exception) {model.message=e.message ?: "Invalid deck"}},enabled=text.isNotBlank()) {Text("Add to pool")}
        TextButton(onClick={model.clearCustom()}) {Text("Clear custom opponents for this format")}
    }
}
@Composable private fun SetupScreen(model: Workbench, diagnostics: () -> Unit, restore: () -> Unit) {
    val context=androidx.compose.ui.platform.LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
        PageTitle("04 / Local engine",if(model.firstSetup) "Welcome to\nyour workbench." else "Ready on\nyour device.","Forge runs directly on Android. No Docker, desktop Java, Node, account, or analysis server is required.")
        Text("1   Install engine data\n2   Initialize Forge and its card database\n3   Check a deck and select opponents",lineHeight=28.sp)
        Text("The APK includes verified Forge ${BuildConfig.FORGE_VERSION} resources. First setup extracts them into private app storage and shows real extraction progress. Initialization uses a separate process and can take a few minutes on slower phones.",fontSize=14.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick={model.setup()},enabled=!model.busy,modifier=Modifier.fillMaxWidth().height(52.dp),shape=RoundedCornerShape(6.dp)) { Text(if(model.firstSetup) "Set up local engine" else "Verify local engine") }
        if(model.busy) TextButton(onClick={ForgeClient.cancel("setup")}) {Text("Cancel setup")}
        OutlinedButton(onClick=diagnostics,enabled=!model.exportingDiagnostics) {Text("Export diagnostic logs")}
        Text("Save a readable summary, engine errors, setup events and Android process-exit reasons. Logs stay on this device until you choose where to save the ZIP.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        ResourceStatusPanel()
        OutlinedButton(onClick=restore,enabled=!model.busy) {Text("Import exported analyses")}
        Text("Restore analysis JSON files saved through Runs → Export results and game evidence, including exports from 0.1.1. Decklists, opponent lists and observed actions are preserved; imported runs never start automatically. Diagnostic ZIP files cannot restore full analysis history.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider()
        PerformancePanel(model)
        HorizontalDivider();Text("Resource policy",fontSize=19.sp)
        Text("The saved parallel-game limit is shared by all Forge work. Each process has isolated game state. Advisory memory pressure or severe thermal throttling limits work to one process; critical thermal status or insufficient measured free RAM stops startup. Single-engine setup uses a fixed headroom allowance; parallel work reserves additional system memory. Long analyses keep a visible notification and a bounded wake lock. Cancel from Runs. Android may still stop work under memory or battery pressure; completed match evidence is saved.",fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Latest stable Forge",fontSize=19.sp)
        Text("Bundled: ${BuildConfig.FORGE_VERSION} · Latest checked: ${model.latest.ifBlank { "not checked" }}. New engine code arrives in a signed app update. Version checks occur hourly when online; cached verification is accepted for 26 hours. New runs stop when a newer stable engine is available.",fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://github.com/acocalypso/magictester/releases")))}) {Text("App releases")}
        Text("What the results mean",fontSize=19.sp)
        Text("Forge AI chooses plays, mulligans and, in best-of-three, sideboard swaps. Action histories show what the engine recorded, including turns, casts, damage and life changes. They are an observation log, not an interactive replay. Commander uses native multiplayer rules and supports legal commander pairs. cEDH uses the same rules with a competitive opponent sample. Duel Commander uses 20 starting life and disables commander-damage elimination.",fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Privacy & licenses",fontSize=19.sp)
        Text("Decks, jobs and results stay in private app storage. Public-link imports contact their host; legality checks send card names to Scryfall; metagame refreshes contact MTGTop8; release checks contact GitHub. No analytics or remote fonts. GPL-3.0 source and bundled third-party notices are available in the repository and APK.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://github.com/acocalypso/magictester/tree/main/android")))}) {Text("Source code & build instructions")}
    }
}

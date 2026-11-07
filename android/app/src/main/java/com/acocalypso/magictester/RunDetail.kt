package com.acocalypso.magictester

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.sqrt

@Composable fun RunDetail(model: Workbench, id: String, back: () -> Unit, deck: (Pair<String,String>) -> Unit, export: (String) -> Unit, diagnostics: (String) -> Unit, delete: (String) -> Unit) {
    val run = model.runs.firstOrNull { it.id == id } ?: return
    var results by remember(id) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var selectedGame by remember(id) { mutableStateOf<JSONObject?>(null) }
    var timeout by remember(id) { mutableIntStateOf(run.payload.optInt("clockSeconds",120)) }
    LaunchedEffect(run.completed,run.state) { results=withContext(Dispatchers.IO) { model.store.results(id) } }
    selectedGame?.let { game -> GameActions(game) { selectedGame=null };return }
    val completed=results.filter { it.optString("termination") in listOf("normal","rule_draw") }.distinctBy { it.optInt("index") }
    val decisive=completed.filter { it.optString("termination") == "normal" }
    val wins=decisive.count { !it.isNull("winner") && it.optInt("winner",-1) == 0 }
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(22.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        item { TextButton(onClick=back) { Text("← All analyses") };Text(run.payload.optString("title"),fontSize=28.sp,fontWeight=FontWeight.Medium);Text("${run.payload.optString("format")} · Forge ${run.payload.optString("engineVersion")} · ${run.state}",fontSize=13.sp);Spacer(Modifier.height(10.dp));Text(run.label,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        item { LiveGamePanel(run) }
        item {
            Row(horizontalArrangement=Arrangement.spacedBy(24.dp)) { Column { Text("${completed.size}",fontSize=36.sp);Text("finished matches",fontSize=12.sp) };Column { Text(if(decisive.isEmpty()) "—" else "${wins*100/decisive.size}%",fontSize=36.sp);Text("observed wins",fontSize=12.sp) } }
            if(decisive.isNotEmpty()) { val n=decisive.size.toDouble();val p=wins/n;val d=1+3.8416/n;val mid=(p+1.9208/n)/d;val radius=1.96*sqrt(p*(1-p)/n+0.9604/(n*n))/d;Text("95% Wilson interval: ${((mid-radius)*100).toInt()}–${((mid+radius)*100).toInt()}%. Selected-pool estimate; unfinished attempts are excluded.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        item { OutlinedButton(onClick={deck(run.payload.optString("title") to run.payload.getString("deck"))}) { Text("Your decklist") }
            val opponents=run.payload.getJSONArray("opponents")
            for(i in 0 until opponents.length()) { val opponent=opponents.getJSONObject(i);TextButton(onClick={deck(opponent.getString("name") to opponent.getString("text"))}) { Text("Opponent: ${opponent.getString("name")}") } }
        }
        item {
            if(run.state in listOf("queued","running")) OutlinedButton(onClick={model.cancel(id)}) { Text("Cancel analysis") }
            if(run.state in listOf("failed","interrupted","cancelled")) {
                Text("Resume unfinished matches · $timeout seconds per game")
                Slider(timeout.toFloat(),{timeout=(it.toInt()/5*5).coerceIn(5,300)},valueRange=5f..300f,steps=58)
                Button(onClick={model.resume(id,timeout)}) { Text("Resume with these settings") }
                Text("Completed matches are preserved. Failed attempts remain visible. The new timeout applies only to unfinished matches.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick={export(id)}) {Text("Export results and game evidence")}
            OutlinedButton(onClick={diagnostics(id)},enabled=!model.exportingDiagnostics) {Text("Export diagnostic logs")}
            TextButton(onClick={delete(id)}) {Text("Delete analysis")}
        }
        item { HorizontalDivider();Text("Match evidence",fontSize=20.sp);Text("Each card below is a real engine attempt. Expand a match to inspect its games and recorded actions.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        if(results.isEmpty()) item { Text("No match evidence saved yet. Initialization and the first game may take a few minutes.",fontSize=13.sp) }
        items(results.asReversed()) { result ->
            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                val index=result.optInt("index")
                val normal=result.optString("termination") == "normal"
                Text("Match ${index+1} · ${if(normal) if(result.optInt("winner",-1)==0) "Your deck won" else "Opponent won" else result.optString("termination").replace('_',' ')}",fontWeight=FontWeight.SemiBold)
                Text("${result.optLong("durationMs")/1000}s · ${result.optInt("clockSeconds",run.payload.optInt("clockSeconds"))}s limit · seed ${result.optInt("gameSeed")} · ${result.optString("unit","game")}",fontSize=12.sp)
                val opponents=run.payload.getJSONArray("opponents")
                val seats=if(run.payload.getString("format") in listOf("commander","cedh")) run.payload.optInt("players",4) else 2
                for(seat in 1 until seats) { val opponent=opponents.getJSONObject((index+seat-1)%opponents.length());Text("Seat ${seat+1}: ${opponent.getString("name")}",fontSize=12.sp) }
                if(!normal) Text("This attempt does not contribute a win or loss. You can inspect partial actions and retry with more time.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                val games=result.optJSONArray("games")
                if(games==null) TextButton(onClick={selectedGame=result}) {Text("View observed game →")}
                else for(i in 0 until games.length()) { val game=games.getJSONObject(i);TextButton(onClick={selectedGame=game}) {Text("Game ${i+1}: ${game.optString("termination").replace('_',' ')} · view actions →")} }
            } }
        }
    }
}
@Composable private fun GameActions(game: JSONObject, back: () -> Unit) {
    val log=game.optJSONObject("actionLog")
    val array=log?.optJSONArray("entries")
    val entries=if(array==null) emptyList() else (0 until array.length()).map { array.getJSONObject(it) }
    var keyOnly by remember { mutableStateOf(true) }
    val visible=if(keyOnly) entries.filter { it.optString("kind") !in listOf("PHASE","MANA") } else entries
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(22.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        item { TextButton(onClick=back) {Text("← Match evidence")};Text("Observed game",fontSize=28.sp);Text("${game.optInt("turns")} turns · ${game.optString("termination").replace('_',' ')}",fontSize=13.sp)
            Row { Checkbox(keyOnly,{keyOnly=it});Text("Hide phase and mana details",Modifier.padding(top=12.dp),fontSize=13.sp) }
            Text(if(log?.optBoolean("complete") == true) "Complete recorded action history." else "Partial history: the game stopped or reached the log size limit. Omitted actions cannot be reconstructed.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            val placements=game.optJSONArray("players")
            val life=game.optJSONArray("startingLife")
            if(placements != null) for(i in 0 until placements.length()) {
                val player=placements.getJSONObject(i)
                Text("Seat ${i+1} · " + (if(player.isNull("placement")) "placement not determined" else "finished ${player.optInt("placement")} of ${placements.length()}") + (if(life != null) " · started at ${life.optInt(i)} life" else ""),fontSize=12.sp)
            }
            val changes=game.optJSONArray("sideboardChanges")
            if(changes != null) for(i in 0 until changes.length()) {val change=changes.getJSONObject(i);for(key in listOf("added","removed")) {val cards=change.optJSONArray(key) ?: continue;for(j in 0 until cards.length()) {val card=cards.getJSONObject(j);Text("Seat ${change.optInt("player")+1} ${if(key=="added") "brought in" else "took out"} ${card.optInt("quantity")} ${card.optString("name")}",fontSize=12.sp)}}}
        }
        if(visible.isEmpty()) item {Text("No actions were recorded for this attempt.")}
        items(visible) { action -> Column {Text("TURN ${action.optInt("turn")} · ${action.optString("kind").replace('_',' ')}",fontSize=10.sp,color=MaterialTheme.colorScheme.primary);Text(action.optString("text"),fontSize=14.sp);HorizontalDivider(Modifier.padding(top=10.dp),color=MaterialTheme.colorScheme.surfaceVariant)} }
    }
}

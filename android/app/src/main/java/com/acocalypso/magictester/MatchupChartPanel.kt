package com.acocalypso.magictester

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.Locale
import kotlin.math.*

object MatchupChartLabels {
    fun rate(c: MatchupCounts)=c.rate?.let {if(abs(it*100-(it*100).roundToInt())<0.001) "${(it*100).roundToInt()}%" else String.format(Locale.US,"%.1f%%",it*100)} ?: "—"
    fun interval(c: MatchupCounts)=c.interval?.let {"${floor(it.first*100).toInt()}–${ceil(it.second*100).toInt()}%"} ?: "—"
    fun empty(c: MatchupCounts)=when {c.planned==0->"Not scheduled";c.unpaired>0->"Waiting for pair";else->"No finished matches"}
    fun color(c: MatchupCounts,base: Color=Color(0xFF252A2D)): Color {
        val rate=c.rate ?: return base
        val strength=(0.08+0.30*sqrt(c.finished.toDouble()/(c.finished+20)))*abs(rate-0.5)*2
        return lerp(base,if(rate>=0.5)Color(0xFF6FAF9A) else Color(0xFFC78488),strength.toFloat())
    }
}

@Composable fun MatchupChartPanel(model: Workbench,run: Run,results: List<JSONObject>,expanded: Boolean,onExpandedChange: (Boolean)->Unit) {
    val peer=model.runs.firstOrNull {it.id!=run.id && run.payload.optString("comparisonId").isNotBlank() && it.payload.optString("comparisonId")==run.payload.optString("comparisonId") && it.payload.optString("comparisonRole")!=run.payload.optString("comparisonRole")}
    var peerResults by remember(peer?.id) {mutableStateOf<List<JSONObject>>(emptyList())}
    // Current results are already loaded by RunDetail. Build their cells immediately
    // so returning from a game restores the same list height and scroll position.
    val chart=remember(run,results,peer,peerResults) {MatchupCharts.build(run,results,peer,peerResults)}
    var detail by remember(run.id) {mutableStateOf<Pair<Int,Int>?>(null)}
    var pending by remember {mutableStateOf<MatchupChartData?>(null)}
    var saving by remember {mutableStateOf(false)}
    var message by remember {mutableStateOf("")}
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    val exporter=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) {uri->
        val snapshot=pending;pending=null
        if(uri!=null && snapshot!=null)scope.launch {
            saving=true
            try {
                withContext(Dispatchers.IO) {context.contentResolver.openOutputStream(uri)?.use {MatchupChartPdf.write(snapshot,it)} ?: error("The selected file could not be opened")}
                message="Matchup chart saved."
            } catch(error:Exception) {
                if(error is CancellationException)throw error
                Diagnostics.event("chart.export_failed","Matchup chart could not be saved",run.id,level="ERROR",error=error);message="Chart could not be saved: ${error.message}"
            } finally {saving=false}
        }
    }
    LaunchedEffect(peer?.id,peer?.completed,peer?.state,peer?.label) {
        peerResults=withContext(Dispatchers.IO) {peer?.let {model.store.results(it.id)} ?: emptyList()}
    }
    val data=chart ?: return
    OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text(data.title,fontSize=20.sp,fontWeight=FontWeight.Medium)
        Text("Your deck: ${data.deck}",fontSize=13.sp)
        if(run.state!="complete")Text(if(run.state in listOf("running","queued")) "Live snapshot · results may still be incomplete" else "Incomplete analysis · unfinished attempts are excluded",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick={onExpandedChange(!expanded)}) {Text(if(expanded) "Hide matchup chart" else "Show matchup chart")}
        if(expanded) {
            Text(data.note,fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            BoxWithConstraints(Modifier.fillMaxWidth()) {
            val cellWidth=if(data.rows.size==1)(maxWidth-125.dp).coerceAtLeast(98.dp) else 98.dp
            Column(Modifier.horizontalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                Row(horizontalArrangement=Arrangement.spacedBy(3.dp)) {
                    Text(if(data.multiplayer) "Opponent table" else "Opponent",modifier=Modifier.width(122.dp).heightIn(min=44.dp),fontSize=12.sp)
                    for(row in data.rows)Text(row.label,modifier=Modifier.width(cellWidth).heightIn(min=44.dp),fontSize=12.sp,fontWeight=FontWeight.Medium)
                }
                Row(horizontalArrangement=Arrangement.spacedBy(3.dp)) {
                    Text("Overall",modifier=Modifier.width(122.dp).height(92.dp),fontSize=13.sp,fontWeight=FontWeight.SemiBold)
                    for((column,row) in data.rows.withIndex())ChartCell(row.total,"Overall · ${row.label}","matchup-cell-overall-$column",cellWidth) {detail=-1 to column}
                }
                for((index,group) in data.groups.withIndex())Row(horizontalArrangement=Arrangement.spacedBy(3.dp)) {
                    Column(Modifier.width(122.dp).heightIn(min=92.dp)) {
                        Text(group.title,fontSize=13.sp,fontWeight=FontWeight.Medium)
                        if(data.multiplayer)Text("${group.opponents.size} opponents · tap a cell for decks",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    for((column,row) in data.rows.withIndex())ChartCell(row.groups[index],"${group.title} · ${row.label}","matchup-cell-$index-$column",cellWidth) {detail=index to column}
                }
            }
            }
            Text("W–L–D = wins, losses, draws. Ranges are 95% Wilson confidence intervals. Teal indicates more wins, rose fewer; tint reflects win rate and sample size. Tap a cell for details.",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(data.provenance,fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick={pending=data;exporter.launch("MagicTester-${run.payload.optString("format")}-matchups.pdf")},enabled=!saving) {Text(if(saving) "Saving chart…" else "Save matchup chart (PDF)")}
            if(message.isNotBlank())Text(message,fontSize=12.sp)
        }
    }}
    detail?.let {(groupIndex,column)->
        val row=data.rows.getOrNull(column) ?: return@let
        val count=if(groupIndex<0)row.total else row.groups.getOrNull(groupIndex) ?: return@let
        AlertDialog(onDismissRequest={detail=null},title={Text("Matchup details")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text(if(groupIndex<0) "Overall" else data.groups[groupIndex].opponents.joinToString("\n"))
            Text(row.label)
            Text("Match win rate: ${MatchupChartLabels.rate(count)}\n${count.wins} wins · ${count.losses} losses · ${count.draws} draws")
            Text("95% confidence interval: ${MatchupChartLabels.interval(count)}")
            Text("${count.finished} included · ${count.observedFinished} finished here · ${count.planned} scheduled\n${count.unfinished} unfinished · ${count.unpaired} awaiting a matching result\n${count.failedAttempts} unfinished or unusable attempts (including earlier retries)")
            if(count.finished<20)Text("Small sample: a few games can change this rate substantially.")
            if(data.multiplayer)Text("This is the outcome against the whole pod, not a win rate against each individual deck.")
        }},confirmButton={TextButton(onClick={detail=null}) {Text("Close")}})
    }
}

@Composable private fun ChartCell(count: MatchupCounts,label: String,tag: String,width: Dp,onClick: ()->Unit) {
    Column(Modifier.width(width).heightIn(min=92.dp).background(MatchupChartLabels.color(count),RoundedCornerShape(3.dp)).clickable(onClick=onClick)
        .testTag(tag).semantics(mergeDescendants=true) {contentDescription="$label. ${MatchupChartLabels.rate(count)}. ${count.wins} wins, ${count.losses} losses, ${count.draws} draws. ${count.finished} finished matches. 95% interval ${MatchupChartLabels.interval(count)}."}
        .padding(8.dp),verticalArrangement=Arrangement.spacedBy(3.dp)) {
        Text(MatchupChartLabels.rate(count),fontSize=21.sp,fontWeight=FontWeight.SemiBold,color=Color(0xFFF2F2EE))
        Text(if(count.finished==0)MatchupChartLabels.empty(count) else "${count.wins}–${count.losses}–${count.draws} · n=${count.finished}",fontSize=10.sp,color=Color(0xFFCDD2D0))
        if(count.finished>0)Text("95%: ${MatchupChartLabels.interval(count)}",fontSize=9.sp,color=Color(0xFFCDD2D0))
    }
}

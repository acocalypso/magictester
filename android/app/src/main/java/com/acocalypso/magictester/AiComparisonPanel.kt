package com.acocalypso.magictester

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

@Composable fun AiComparisonPanel(model: Workbench,run: Run) {
    val peers=model.runs.filter {it.payload.optString("comparisonId")==run.payload.optString("comparisonId")}
    val baseline=peers.firstOrNull {it.payload.optString("comparisonRole")=="baseline"}
    val candidate=peers.firstOrNull {it.payload.optString("comparisonRole")=="candidate"}
    var summary by remember(run.id) {mutableStateOf<AiComparisonSummary?>(null)}
    LaunchedEffect(run.id,peers.map {Triple(it.id,it.completed,it.state)}) {
        summary=if(baseline==null || candidate==null) AiComparisonSummary(message="The other analysis is missing. Keep both linked analyses to compare AI results.") else withContext(Dispatchers.IO) {
            AiComparisonEvidence.summarize(baseline.payload,candidate.payload,model.store.results(baseline.id),model.store.results(candidate.id))
        }
    }
    OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(when(candidate?.payload?.optString("aiScope",AiPolicy.ALL)) {AiPolicy.YOUR_DECK->"Your-deck AI comparison · legacy";AiPolicy.ALL->"All-player AI comparison";else->"AI comparison"},fontSize=19.sp,fontWeight=FontWeight.Medium)
        summary?.let {report->
            report.score?.takeIf {it.pairs>0}?.let {score->
                fun percent(wins: Int)=String.format(Locale.US,"%.1f",100.0*wins/score.pairs)
                val delta=String.format(Locale.US,"%+.1f",score.percentagePoints)
                Text(when {score.extraWins>0->"Your deck: ${score.extraWins} more wins";score.extraWins<0->"Your deck: ${-score.extraWins} fewer wins";else->"Your deck: same number of wins"},fontSize=20.sp)
                Text("$delta percentage points in match win rate",fontSize=14.sp)
                Text("Default: ${score.defaultWins}/${score.pairs} wins (${percent(score.defaultWins)}%)\nExperimental: ${score.experimentalWins}/${score.pairs} wins (${percent(score.experimentalWins)}%)",fontSize=14.sp)
                Text("Gained wins: ${score.gainedWins} · Lost wins: ${score.lostWins}\nMatched outcomes: ${score.pairs}/${run.payload.optInt("games")}. Draws count as finished matches, not wins.",fontSize=12.sp)
                if(baseline?.state!="complete" || candidate?.state!="complete" || score.pairs<run.payload.optInt("games")) Text("Partial comparison — remaining, interrupted and timed-out matches are excluded.",fontSize=12.sp)
                Text(score.verdict,fontSize=13.sp)
                Text("Repeat with more seeds and opponents to assess matchup performance. Your seat stays fixed.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(report.message,fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(report.excludedPairs>0) Text("${report.excludedPairs} finished pairs excluded: clock, seed, engine build or AI evidence did not match.",fontSize=12.sp,color=MaterialTheme.colorScheme.error)
        } ?: Text("Loading comparison…",fontSize=12.sp)
    }}
}

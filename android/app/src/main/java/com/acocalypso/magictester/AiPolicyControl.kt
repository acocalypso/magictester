package com.acocalypso.magictester

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable fun AiPolicyControl(policy: String,enabled: Boolean,onChange: (String)->Unit) {
    var expanded by remember {mutableStateOf(false)}
    Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("AI: ${AiPolicy.label(policy)}",fontSize=15.sp)
        Box {
            OutlinedButton(onClick={expanded=true},enabled=enabled) {Text("Choose AI policy")}
            DropdownMenu(expanded,onDismissRequest={expanded=false}) {
                for(option in AiPolicy.options) DropdownMenuItem(text={Text(AiPolicy.label(option))},onClick={onChange(option);expanded=false})
            }
        }
        Text(when(policy) {
            AiPolicy.STRATEGIC -> "Strategic v1 adds mana-aware opening hands, London bottom selection, conditional haste and team-haste sequencing, plus bounded search for simple two-player combat. Complex hands and combat retain native Forge logic. Includes Expanded v2 corrections."
            AiPolicy.EXPANDED -> "Expanded v2 adds life-loss lethal, safer mill and draw targets, discard value, poison immunity, paid-X and Metalcraft burn. Combat, mulligans and combo search remain native Forge."
            AiPolicy.TACTICAL -> "Tactical v1 improves simple burn-target choices against protected players. Other decisions use Forge's native AI."
            else -> "Native Forge is the reference policy. Choose an experimental policy to test the new tactical corrections."
        },fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text("A normal analysis uses the same policy for every deck. Experiments are not a proven overall win-rate improvement.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable fun GameAiDetails(game: JSONObject,payload: JSONObject) {
    val seats=game.optJSONObject("ai")?.optJSONArray("seats")
    if(seats==null) {
        Text("AI setting: ${AiPolicy.label(payload.optString("aiPolicy",AiPolicy.STABLE))} · engine policy metadata unavailable in this older evidence",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        val entries=(0 until seats.length()).map {seats.getJSONObject(it)}
        if(entries.isEmpty()) {
            Text("AI policy metadata is empty in this evidence.",fontSize=12.sp)
        } else if(entries.map {it.optString("id")}.distinct().size==1) {
            Text("AI: ${AiPolicy.label(entries.first().optString("id"))} · all seats",fontSize=12.sp)
        } else for(entry in entries) {
            Text("${PlayerLabels.name(entry.optInt("seat"))} AI: ${AiPolicy.label(entry.optString("id"))}",fontSize=12.sp)
        }
        val timeoutCount=entries.sumOf {it.optLong("evaluationTimeouts")}
        if(timeoutCount>0) Text("AI evaluation timeouts: $timeoutCount. These are separate from the whole-game clock.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        val suggestions=linkedMapOf<String,Long>()
        for(entry in entries) entry.optJSONObject("evaluationSuggestions")?.let {values ->
            for(key in values.keys()) suggestions[key]=(suggestions[key] ?: 0)+values.optLong(key)
        }
        if(suggestions.values.any {it>0}) {
            Text("AI planning suggestions · checks may repeat before a spell is cast",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            val labels=mapOf("burn-lethal" to "Burn target priority","life-loss-lethal" to "Lethal life-loss target","discard-card-count" to "Discard value target","mill-public-protection" to "Mill target with public protection checked","draw-library-boundary" to "Draw-to-deck proposal rejected","poison-immune-targets" to "Poison against immune players declined","mulligan-keep-changed" to "Opening-hand decision changed","mulligan-bottom-selected" to "London bottom selection","conditional-haste-main1" to "Conditional haste evaluated before combat","mana-refund-main1" to "Mana-refund creature evaluated before combat","team-haste-setup-main1" to "Creature setup before team haste","team-haste-order" to "Team-haste spell reordered","combat-guaranteed-lethal" to "Guaranteed lethal attack found","combat-block-search" to "Blocking assignment improved")
            for((key,count) in suggestions) if(count>0) Text("${labels[key] ?: key.replace('-',' ')}: $count",fontSize=12.sp)
        }
        game.optString("engineBuildSha256").takeIf {it.isNotEmpty()}?.let {Text("Engine build ${it.take(12)}",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    }
}

package com.acocalypso.magictester

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable fun AiPolicyControl(policy: String,enabled: Boolean,onChange: (String)->Unit) {
    Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("AI: ${AiPolicy.label(policy)}",fontSize=15.sp)
        Row(verticalAlignment=Alignment.CenterVertically) {
            Switch(policy==AiPolicy.TACTICAL,{onChange(if(it) AiPolicy.TACTICAL else AiPolicy.STABLE)},enabled=enabled,modifier=Modifier.semantics {contentDescription="Try experimental burn targeting"})
            Spacer(Modifier.width(10.dp))
            Text("Try experimental burn targeting",fontSize=14.sp)
        }
        Text("The same policy pilots your deck and every opponent. Tactical v1 improves simple burn-target choices against protected players. Other decisions use Forge's native AI. A higher overall win rate has not been established.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
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
    }
}

package com.acocalypso.magictester

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File

class MatchupChartTest {
    private fun payload(format: String="pauper",players: Int=2,pool: Int=3)=JSONObject().put("title","Red rally").put("format",format).put("players",players)
        .put("games",6).put("bestOf",1).put("seed",12345).put("clockSeconds",120).put("deck","Frozen own deck").put("engineVersion","2.0.15").put("engineBuildSha256","hash")
        .put("aiPolicy",AiPolicy.STRATEGIC).put("opponents",JSONArray().apply {for(i in 0 until pool)put(JSONObject().put("name",listOf("Dimir Control","Affinity","Burn")[i%3]+if(i>2) " $i" else "").put("text","Frozen deck $i"))})
    private fun outcome(index: Int,winner: Int?,termination: String="normal",policy: String=AiPolicy.STRATEGIC)=JSONObject().put("index",index).put("unit","game").put("termination",termination).put("winner",winner ?: JSONObject.NULL)
        .put("gameSeed",index+123).put("clockSeconds",120).put("engineVersion","2.0.15").put("engineBuildSha256","hash")
        .put("ai",JSONObject().put("seats",JSONArray().put(JSONObject().put("seat",0).put("id",policy)).put(JSONObject().put("seat",1).put("id",policy))))
    @Test fun existingRunsProduceMatchupRowsAndCommanderUsesWholePods() {
        val p=payload();val chart=MatchupCharts.build(Run("old","complete","",6,p),listOf(outcome(0,0),outcome(3,1),outcome(1,null,"rule_draw")))!!
        assertEquals(3,chart.groups.size);assertEquals(0.5,chart.rows.single().groups[0].rate!!,0.0)
        assertEquals(1,chart.rows.single().groups[1].draws);assertNull(chart.rows.single().groups[2].rate)
        val commander=MatchupCharts.build(Run("pod","complete","",1,payload("commander",4)),listOf(outcome(0,0)))!!
        assertTrue(commander.multiplayer);assertEquals(listOf("Dimir Control","Affinity","Burn"),commander.groups[0].opponents)
        assertEquals(1,commander.rows.single().groups[0].wins);assertEquals(0,commander.rows.single().groups[1].wins)
        assertTrue(commander.note.contains("entire multiplayer table"))
        val bo3=outcome(0,0).put("unit","match").put("games",JSONArray().put(outcome(0,0)).put(outcome(1,0)))
        assertEquals(1,MatchupCharts.build(Run("bo3","complete","",1,p.put("bestOf",3)),listOf(bo3))!!.rows.single().total.finished)
    }
    @Test fun pairedHeatmapUsesOnlyVerifiedSharedIndices() {
        val pair=AiComparison.prepare(payload(),"chart-pair");val baseline=Run("a","complete","",2,pair[0]);val candidate=Run("b","complete","",2,pair[1])
        val native=listOf(outcome(0,1,policy=AiPolicy.STABLE),outcome(1,0,policy=AiPolicy.STABLE))
        val experimental=listOf(outcome(0,0),outcome(1,0).put("clockSeconds",300))
        val chart=MatchupCharts.build(candidate,experimental,baseline,native)!!
        assertEquals(2,chart.rows.size);assertEquals(0,chart.rows[0].total.wins);assertEquals(1,chart.rows[1].total.wins)
        assertEquals(1,chart.rows[0].total.finished);assertEquals(1,chart.rows[1].total.unpaired)
        assertTrue(chart.provenance.contains("candidate for all players"))
        pair[1].put("aiScope",AiPolicy.YOUR_DECK)
        val legacyResults=experimental.map {JSONObject(it.toString()).apply {getJSONObject("ai").getJSONArray("seats").getJSONObject(1).put("id",AiPolicy.STABLE)}}
        val legacyChart=MatchupCharts.build(baseline,native,candidate,legacyResults)!!
        assertTrue(legacyChart.provenance.contains("legacy: candidate on your deck; native opponents"))
        pair[1].put("aiScope",AiPolicy.ALL)
        val invalid=AiComparisonEvidence.summarize(pair[0],pair[1],listOf(outcome(0,null,policy=AiPolicy.STABLE)),listOf(outcome(0,0)))
        assertEquals(0,invalid.score!!.pairs);assertTrue(invalid.matchedIndices.isEmpty())
        val draw=AiComparisonEvidence.summarize(pair[0],pair[1],listOf(outcome(0,0,"rule_draw",AiPolicy.STABLE)),listOf(outcome(0,0,"rule_draw")))
        assertEquals(0,draw.score!!.defaultWins);assertEquals(0,draw.score.experimentalWins)
    }
    @Test fun exportedPdfIncludesEveryMatchupAndRendersWithLocalFonts() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val p=payload(pool=23).put("games",46).put("title","Chart layout preview · test data")
        val pair=AiComparison.prepare(p,"pdf-chart-pair")
        val defaults=(0 until 46).map {outcome(it,if(it%23<4 || (it%23 in 4..7 && it<23))1 else 0,policy=AiPolicy.STABLE)}
        val results=(0 until 46).map {outcome(it,if(it%23<2 || (it%23 in 4..5 && it<23))1 else 0)}
        val chart=MatchupCharts.build(Run("pdf","complete","",46,pair[1]),results,Run("pdf-native","complete","",46,pair[0]),defaults)!!
        assertEquals(2,chart.rows.size)
        val file=File(context.filesDir,"acceptance-matchups.pdf");file.outputStream().use {MatchupChartPdf.write(chart,it)}
        PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)).use {renderer->
            assertEquals(3,renderer.pageCount)
            renderer.openPage(0).use {page->
                val bitmap=Bitmap.createBitmap(756,1008,Bitmap.Config.ARGB_8888)
                page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                assertNotEquals(Color.WHITE,bitmap.getPixel(2,2))
                assertNotEquals(bitmap.getPixel(2,2),bitmap.getPixel(700,180))
                val bytes=ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes)
                File(context.filesDir,"acceptance-matchups.png").writeBytes(bytes.toByteArray())
                val encoded=Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)
                encoded.chunked(2000).forEachIndexed {index,chunk->InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply {putString("stream","MT_CHART_PREVIEW:$index:$chunk\n")})}
                bitmap.recycle()
            }
        }
        val pod=MatchupCharts.build(Run("pods","complete","",6,payload("commander",4)),listOf(outcome(0,0)))!!
        val pods=File(context.cacheDir,"pods-chart.pdf");pods.outputStream().use {MatchupChartPdf.write(pod,it)}
        PdfRenderer(ParcelFileDescriptor.open(pods,ParcelFileDescriptor.MODE_READ_ONLY)).use {assertEquals(2,it.pageCount)}
        pods.delete()
    }
}

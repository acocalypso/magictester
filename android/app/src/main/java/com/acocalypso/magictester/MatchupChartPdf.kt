package com.acocalypso.magictester

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.compose.ui.graphics.toArgb
import java.io.OutputStream
import java.time.Instant

/** Local, vector PDF export. Uses Android's installed fonts and includes every matchup. */
object MatchupChartPdf {
    private const val WIDTH=1080
    private const val HEIGHT=1440
    private const val PER_PAGE=10
    fun write(data: MatchupChartData,output: OutputStream) {
        val document=PdfDocument()
        try {
            val pages=data.groups.indices.chunked(PER_PAGE).ifEmpty {listOf(emptyList())}
            val rosters=if(data.multiplayer || data.groups.any {it.title.length>60})data.groups.flatMap {group->
                listOf(group.title)+group.opponents.flatMapIndexed {index,name->wrap("Opponent ${index+1}: $name",990f,18f)}+listOf("")
            }.chunked(46) else emptyList()
            val totalPages=pages.size+rosters.size
            val captured=Instant.now().toString()
            for((pageIndex,indices) in pages.withIndex()) {
                val page=document.startPage(PdfDocument.PageInfo.Builder(WIDTH,HEIGHT,pageIndex+1).create())
                val canvas=page.canvas;canvas.drawColor(Color.rgb(250,250,247))
                text(canvas,data.title,44f,65f,34f,true)
                wrapped(canvas,"Your deck: ${data.deck}",44f,102f,990f,20f,2)
                val total=data.rows.firstOrNull()?.total ?: MatchupCounts()
                text(canvas,"${total.finished} included / ${total.planned} scheduled matches per policy · snapshot",44f,160f,17f)
                val labelWidth=310f;val left=44f+labelWidth;val cellWidth=(WIDTH-88f-labelWidth)/data.rows.size.coerceAtLeast(1)
                text(canvas,if(data.multiplayer) "Opponent table" else "Opponent",44f,204f,18f,true)
                for((column,row) in data.rows.withIndex())wrapped(canvas,row.label,left+column*cellWidth+12,204f,cellWidth-22,18f,2)
                var y=235f
                drawRow(canvas,"Overall",data.rows.map {it.total},y,left,cellWidth,true);y+=94f
                for(index in indices) {
                    drawRow(canvas,data.groups[index].title,data.rows.map {it.groups[index]},y,left,cellWidth,false)
                    y+=94f
                }
                wrapped(canvas,"W–L–D = wins, losses, draws. Ranges: 95% Wilson intervals. Tint strength increases with the number of matches; small samples remain uncertain.",44f,1300f,990f,14f,2)
                wrapped(canvas,data.note,44f,1342f,990f,13f,3)
                text(canvas,data.provenance,44f,1390f,11f)
                text(canvas,"MagicTester · snapshot $captured · page ${pageIndex+1}/$totalPages",44f,1410f,12f)
                document.finishPage(page)
            }
            for((index,lines) in rosters.withIndex()) {
                val number=pages.size+index+1
                val page=document.startPage(PdfDocument.PageInfo.Builder(WIDTH,HEIGHT,number).create())
                page.canvas.drawColor(Color.rgb(250,250,247));text(page.canvas,"Opponent rosters",44f,65f,32f,true)
                for((line,value) in lines.withIndex())text(page.canvas,value,44f,120f+line*26f,18f)
                text(page.canvas,"MagicTester · snapshot $captured · page $number/$totalPages",44f,1410f,12f)
                document.finishPage(page)
            }
            document.writeTo(output)
        } finally {document.close()}
    }
    private fun wrap(value: String,width: Float,size: Float): List<String> {
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {textSize=size;typeface=Typeface.DEFAULT}
        var remaining=value;val lines=mutableListOf<String>()
        while(remaining.isNotEmpty()) {
            var count=paint.breakText(remaining,true,width,null).coerceAtLeast(1).coerceAtMost(remaining.length)
            if(count<remaining.length)remaining.lastIndexOf(' ',count-1).takeIf {it>0}?.let {count=it}
            lines+=remaining.substring(0,count);remaining=remaining.substring(count).trimStart()
        }
        return lines
    }
    private fun drawRow(canvas: Canvas,label: String,counts: List<MatchupCounts>,y: Float,left: Float,width: Float,overall: Boolean) {
        wrapped(canvas,label,44f,y+31f,290f,if(overall)22f else 20f,3)
        val paint=Paint(Paint.ANTI_ALIAS_FLAG)
        for((column,c) in counts.withIndex()) {
            val x=left+column*width;paint.color=MatchupChartLabels.color(c,androidx.compose.ui.graphics.Color(0xFFF0F1EE)).toArgb();canvas.drawRoundRect(x,y,x+width-4,y+88,4f,4f,paint)
            text(canvas,MatchupChartLabels.rate(c),x+12,y+30,27f,true)
            text(canvas,if(c.finished==0)MatchupChartLabels.empty(c) else "${c.wins}–${c.losses}–${c.draws} · n=${c.finished}",x+12,y+53,14f)
            if(c.finished>0)text(canvas,"95%: ${MatchupChartLabels.interval(c)}",x+12,y+74,13f)
        }
    }
    private fun text(canvas: Canvas,value: String,x: Float,y: Float,size: Float,bold: Boolean=false) {
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {color=Color.rgb(20,23,25);textSize=size;typeface=if(bold)Typeface.DEFAULT_BOLD else Typeface.DEFAULT}
        canvas.drawText(value,x,y,paint)
    }
    private fun wrapped(canvas: Canvas,value: String,x: Float,y: Float,width: Float,size: Float,lines: Int) {
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {textSize=size;typeface=Typeface.DEFAULT}
        var remaining=value.replace('\n',' ')
        repeat(lines) {line->
            if(remaining.isEmpty())return
            var count=paint.breakText(remaining,true,width,null).coerceAtLeast(1).coerceAtMost(remaining.length)
            if(count<remaining.length) {
                val space=remaining.lastIndexOf(' ',count-1)
                if(space>0)count=space
            }
            var content=remaining.substring(0,count);remaining=remaining.substring(count).trimStart()
            if(line==lines-1 && remaining.isNotEmpty())content=content.dropLast(1)+"…"
            text(canvas,content,x,y+line*size*1.3f,size)
        }
    }
}

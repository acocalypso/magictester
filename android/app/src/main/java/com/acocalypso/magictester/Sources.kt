package com.acocalypso.magictester

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import java.net.URI
import java.net.HttpURLConnection
import java.io.File
import java.security.MessageDigest

object Http {
    private val hosts = setOf("api2.moxfield.com","archidekt.com","api.scryfall.com","api.github.com","www.mtgtop8.com","mtgdecks.net")
    fun request(url: String, body: String? = null): String {
        val uri = URI(url)
        require(uri.scheme == "https" && uri.host in hosts && uri.port == -1 && uri.userInfo == null) { "Unsupported source URL" }
        val connection = uri.toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 20000; connection.readTimeout = 30000; connection.instanceFollowRedirects = false
            connection.setRequestProperty("User-Agent","MagicTester-Android/0.1 (+https://github.com/acocalypso/magictester)")
            connection.setRequestProperty("Accept","application/json,text/html;q=0.9,text/plain;q=0.8")
            if (body != null) { connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type","application/json"); connection.outputStream.use { it.write(body.toByteArray()) } }
            require(connection.responseCode in 200..299) { "Source returned HTTP ${connection.responseCode}. Try later or paste a text export." }
            val bytes = connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(32768)
                while(true) { val n = input.read(buffer); if(n < 0) break; require(out.size()+n <= 4_000_000) { "Source exceeds the 4 MB import limit" };out.write(buffer,0,n) }
                out.toByteArray()
            }
            require(bytes.size <= 4_000_000) { "Source exceeds the 4 MB import limit" }
            val charset = connection.contentType?.substringAfter("charset=", "UTF-8")?.substringBefore(';')?.trim() ?: "UTF-8"
            return bytes.toString(java.nio.charset.Charset.forName(charset))
        } finally { connection.disconnect() }
    }
    fun sha(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}
object DeckLinks {
    fun load(link: String): Pair<String,String> {
        val uri = URI(if(link.startsWith("https://")) link.trim() else "https://${link.trim()}")
        require(uri.scheme == "https" && uri.userInfo == null && uri.port == -1) { "Use an HTTPS public deck link." }
        val host = uri.host?.removePrefix("www.")
        val sections = linkedMapOf("Commander" to mutableListOf<String>(), "Deck" to mutableListOf(), "Sideboard" to mutableListOf(), "Companion" to mutableListOf())
        fun add(section: String, name: String, quantity: Int) { require(quantity in 1..1000 && !name.contains('\n')); sections.getValue(section).add("$quantity $name") }
        val title: String
        if (host == "moxfield.com") {
            val id = Regex("^/decks/([A-Za-z0-9_-]{22})(?:/primer)?/?$").matchEntire(uri.path)?.groupValues?.get(1) ?: error("Invalid Moxfield deck URL")
            val data = JSONObject(Http.request("https://api2.moxfield.com/v2/decks/all/$id")); title = data.getString("name")
            for (extra in listOf("signatureSpells","attractions","stickers")) require((data.optJSONObject(extra)?.length() ?: 0) == 0) { "This import contains unsupported $extra." }
            for ((key,section) in listOf("commanders" to "Commander","mainboard" to "Deck","sideboard" to "Sideboard","companions" to "Companion")) {
                val board = data.optJSONObject(key) ?: continue
                board.keys().forEach { val card = board.getJSONObject(it); add(section,card.getJSONObject("card").getString("name"),card.getInt("quantity")) }
            }
        } else if (host == "archidekt.com") {
            val id = Regex("^/decks/([1-9][0-9]{0,11})(?:/[^/]*)?/?$").matchEntire(uri.path)?.groupValues?.get(1) ?: error("Invalid Archidekt deck URL")
            val data = JSONObject(Http.request("https://archidekt.com/api/decks/$id/")); title = data.getString("name")
            require((data.optJSONArray("customCards")?.length() ?: 0) == 0) { "Custom cards cannot be simulated." }
            val excluded = mutableSetOf<String>(); val categories = data.optJSONArray("categories") ?: JSONArray()
            for(i in 0 until categories.length()) { val c = categories.getJSONObject(i); if(!c.optBoolean("includedInDeck",true)) excluded += c.getString("name").lowercase() }
            val cards = data.getJSONArray("cards")
            require(cards.length() <= 2000)
            for (i in 0 until cards.length()) {
                val card = cards.getJSONObject(i); if(!card.isNull("deletedAt")) continue
                val roles = card.optJSONArray("categories") ?: JSONArray()
                val tags = (0 until roles.length()).map { roles.getString(it).lowercase() }
                val section = when { "commander" in tags -> "Commander"; card.optBoolean("companion") || "companion" in tags -> "Companion"; "sideboard" in tags -> "Sideboard"; tags.any { it in excluded || it in listOf("maybeboard","considering") } -> continue; else -> "Deck" }
                add(section,card.getJSONObject("card").getJSONObject("oracleCard").getString("name"),card.getInt("quantity"))
            }
        } else error("Use a Moxfield or Archidekt link, or paste another site's text export.")
        return title to sections.filterValues { it.isNotEmpty() }.entries.joinToString("\n\n") { (section,cards) -> "$section\n${cards.joinToString("\n")}" }
    }
}
class Metagame(private val context: Context) {
    private val directory = File(context.filesDir,"meta").apply { mkdirs() }
    private val codes = mapOf("standard" to "ST","pioneer" to "PI","modern" to "MO","pauper" to "PAU","legacy" to "LE","vintage" to "VI","commander" to "cEDH","cedh" to "cEDH","duel" to "EDH")
    fun cached(format: String): JSONObject? = File(directory,"$format.json").takeIf { it.isFile }?.let { try { JSONObject(it.readText()) } catch (_:Exception) { null } }
    private fun page(url: String): String {
        val uri = URI(url); require(uri.host == "www.mtgtop8.com")
        val robotsFile = File(directory,"robots.txt")
        if(!robotsFile.exists() || System.currentTimeMillis()-robotsFile.lastModified() > 86400000) robotsFile.writeText(Http.request("https://www.mtgtop8.com/robots.txt"))
        // Fail closed on paths disallowed to either the named agent or '*'.
        var relevant = false; var delaySeconds = 1.5
        for(raw in robotsFile.readLines()) {
            val line = raw.substringBefore('#').trim(); val key = line.substringBefore(':').lowercase(); val value = line.substringAfter(':', "").trim()
            when(key) { "user-agent" -> relevant = value == "*" || value.lowercase().contains("magictester")
                "disallow" -> if(relevant && value.isNotEmpty()) { val pattern = "^" + value.split('*').joinToString(".*") { Regex.escape(it.removeSuffix("$")) } + if(value.endsWith('$')) "$" else ""; require(!Regex(pattern).containsMatchIn(uri.rawPath + (uri.rawQuery?.let { "?$it" } ?: ""))) { "Source robots policy does not allow this page." } }
                "crawl-delay" -> if(relevant) delaySeconds = maxOf(delaySeconds,value.toDoubleOrNull() ?: 1.5)
            }
        }
        require(delaySeconds <= 30) { "Source requests a long crawl delay; refresh later." }
        Thread.sleep((delaySeconds*1000).toLong())
        return Http.request(url)
    }
    @Synchronized fun refresh(format: String, force: Boolean = false, progress: (String) -> Unit = {}): JSONObject {
        require(format in DeckText.formats)
        val old = cached(format)
        if(!force && old != null && System.currentTimeMillis()-old.getLong("fetchedAt") < 86400000) return old
        val url = "https://www.mtgtop8.com/format?f=${codes.getValue(format)}"
        progress("Reading $format metagame")
        val html = page(url); var document = Jsoup.parse(html,url)
        if(document.select("a[href*=archetype?]").isEmpty() && DeckText.commander(format)) {
            val meta = Regex("\\bmeta\\s*=\\s*(\\d+)\\s*;").find(html)?.groupValues?.get(1)
            if(meta != null) document = Jsoup.parse(page("https://www.mtgtop8.com/cEDH_decks?f=${codes.getValue(format)}&show=pop&cid=&meta=$meta&gamerid1=&gamerid2=&cEDH_cp=1"),url)
        }
        val archetypes = document.select("a[href*=archetype?]").distinctBy { it.absUrl("href") }.mapNotNull { link ->
            val row = link.closest(".hover_tr") ?: return@mapNotNull null
            val number = Regex("([0-9.,]+)\\s*([%‰])").find(row.text()) ?: return@mapNotNull null
            val share = number.groupValues[1].replace(',','.').toDoubleOrNull()?.div(if(number.groupValues[2] == "‰") 1000 else 100) ?: return@mapNotNull null
            Triple(link.text(),link.absUrl("href"),share)
        }.sortedByDescending { it.third }.take(6)
        require(archetypes.isNotEmpty()) { "No readable metagame found. Cached decks have been kept." }
        val decks = JSONArray()
        for((name,archetype,share) in archetypes) {
            progress("Importing $name")
            try {
                val archetypePage = Jsoup.parse(page(archetype),archetype)
                val link = archetypePage.select("a[href]").firstOrNull { val target = URI(it.absUrl("href")); target.path == "/event" && target.query?.contains("d=") == true } ?: continue
                val deckUrl = link.absUrl("href")
                val source = Jsoup.parse(page(deckUrl),deckUrl)
                val sections = linkedMapOf("Commander" to mutableListOf<String>(),"Deck" to mutableListOf(),"Sideboard" to mutableListOf(),"Companion" to mutableListOf())
                for(row in source.select(".deck_line[id]").distinctBy { it.id() }) {
                    val card = row.selectFirst(".L14")?.text() ?: continue
                    val quantity = Regex("^(\\d+)\\s").find(row.text())?.groupValues?.get(1) ?: continue
                    val heading = row.previousElementSiblings().firstOrNull { it.`is`("div.O14") }?.text()?.uppercase() ?: ""
                    val section = when { heading.contains("COMMANDER") -> "Commander"; heading.contains("COMPANION") -> "Companion"; row.id().startsWith("sb") -> "Sideboard"; else -> "Deck" }
                    sections.getValue(section).add("$quantity $card")
                }
                val text = sections.filterValues { it.isNotEmpty() }.entries.joinToString("\n\n") { "${it.key}\n${it.value.joinToString("\n")}" }
                require(DeckText.parse(text).errors.isEmpty() && sections.getValue("Deck").isNotEmpty())
                decks.put(JSONObject().put("name",name).put("text",text).put("share",share).put("source",deckUrl).put("fetchedAt",System.currentTimeMillis()))
            } catch (_:Exception) { /* Keep only whole readable decklists, never a fabricated fallback. */ }
        }
        require(decks.length() > 0) { "No complete public opponent decks could be imported. Cached decks have been kept." }
        val result = JSONObject().put("format",format).put("source",url).put("fetchedAt",System.currentTimeMillis()).put("scope",if(format == "commander") "Competitive Commander tournament sample; not representative of casual tables" else "Public tournament sample").put("decks",decks)
        val temporary = File(directory,"$format.partial"); temporary.writeText(result.toString());check(temporary.renameTo(File(directory,"$format.json")))
        return result
    }
}
object ForgeRelease {
    fun check(context: Context): String {
        val prefs = context.getSharedPreferences("updates",Context.MODE_PRIVATE)
        val time = System.currentTimeMillis()
        if(time-prefs.getLong("checked",0) < 3600000) return prefs.getString("latest","") ?: ""
        val data = JSONObject(Http.request("https://api.github.com/repos/Card-Forge/forge/releases/latest"))
        require(!data.getBoolean("prerelease") && !data.getBoolean("draft"))
        val latest = data.getString("tag_name").removePrefix("forge-")
        prefs.edit().putString("latest",latest).putLong("checked",time).apply()
        return latest
    }
    fun requireCurrent(context: Context) {
        val prefs = context.getSharedPreferences("updates",Context.MODE_PRIVATE)
        val latest = try { check(context) } catch(_:Exception) {
            require(System.currentTimeMillis()-prefs.getLong("checked",0) < 26*3600000L) { "Connect to the internet to verify the latest stable Forge release before starting a run." }
            prefs.getString("latest","") ?: ""
        }
        require(latest == BuildConfig.FORGE_VERSION) { "Forge $latest is available. Install the matching MagicTester Android update before running new games." }
    }
}

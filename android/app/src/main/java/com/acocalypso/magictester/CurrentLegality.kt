package com.acocalypso.magictester

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Scryfall is queried in batches, and complete responses are cached per card daily. */
class CurrentLegality(context: Context, private val collection: (String) -> String = { Http.request("https://api.scryfall.com/cards/collection",it) }, private val directory: File = File(context.filesDir,"legality")) {
    init { directory.mkdirs() }
    fun check(texts: List<String>, format: String, progress: (String) -> Unit = {}): String {
        val names = texts.flatMap { DeckText.parse(it).cards }.map { it.name }.distinct()
        val files = names.associateWith { File(directory,Http.sha(it.lowercase()) + ".json") }
        val missing = names.filter { name -> val f=files.getValue(name); !f.isFile || System.currentTimeMillis()-f.lastModified() > 86400000 }
        for(chunk in missing.chunked(75)) {
            progress("Checking current card legality · ${names.size-missing.size}/${names.size} cached")
            val response = JSONObject(collection(JSONObject().put("identifiers",JSONArray(chunk.map { JSONObject().put("name",it) })).toString()))
            val unknown = response.optJSONArray("not_found") ?: JSONArray()
            require(unknown.length() == 0) { "Scryfall could not identify: ${(0 until unknown.length()).joinToString { unknown.getJSONObject(it).optString("name") }}" }
            val data = response.getJSONArray("data")
            for(i in 0 until data.length()) {
                val card = data.getJSONObject(i); val canonical = card.getString("name")
                val matches = chunk.filter { it.equals(canonical,true) || it.equals(canonical.substringBefore(" // "),true) }
                for(name in matches) files.getValue(name).writeText(card.toString())
            }
            Thread.sleep(120)
        }
        val key = if(format == "cedh") "commander" else format
        val problems = mutableListOf<String>()
        for(name in names) {
            val file=files.getValue(name)
            require(file.isFile) { "Could not check $name. Use its full official card name." }
            val legality = JSONObject(file.readText()).getJSONObject("legalities").optString(key)
            if(format == "duel" && legality == "restricted" && texts.any { text -> DeckText.parse(text).cards.any { it.section == "Commander" && it.name.equals(name,true) } }) problems += "$name is banned as a commander in Duel Commander; it may be included in the library."
            if(format != "duel" && legality == "restricted" && texts.any { text -> DeckText.parse(text).cards.filter { it.name.equals(name,true) }.sumOf { it.quantity } > 1 }) problems += "$name is restricted to one copy in $format."
            if(legality !in listOf("legal","restricted")) problems += "$name is ${legality.ifBlank { "not supported" }.replace('_',' ')} in $format."
        }
        require(problems.isEmpty()) { problems.joinToString("\n") }
        return "Current Scryfall legality checked ${java.time.Instant.now()}"
    }
}

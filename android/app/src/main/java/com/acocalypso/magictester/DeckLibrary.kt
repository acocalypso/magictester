package com.acocalypso.magictester

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

object DeckLibraryEvents {val changes=MutableStateFlow(0L);fun changed() {changes.update {it+1}}}
data class SavedDeckSummary(val id: String,val name: String,val format: String,val cardCount: Int,val updatedAt: Long)
data class SavedDeck(val id: String,val name: String,val format: String,val text: String,val sourceUrl: String,val updatedAt: Long)

/** Listing reads only metadata. Full deck text is fetched when one deck is opened. */
class DeckLibrary(context: Context): SQLiteOpenHelper(context,"decks.db",null,1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE decks(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE,format TEXT NOT NULL,deck_text TEXT NOT NULL,source_url TEXT NOT NULL,card_count INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(name,format))")
        db.execSQL("CREATE INDEX decks_updated ON decks(updated DESC)")
    }
    override fun onUpgrade(db: SQLiteDatabase,old: Int,new: Int) {}
    fun all(): List<SavedDeckSummary> = readableDatabase.rawQuery("SELECT id,name,format,card_count,updated FROM decks ORDER BY updated DESC,rowid DESC",null).use {cursor ->buildList {while(cursor.moveToNext()) add(SavedDeckSummary(cursor.getString(0),cursor.getString(1),cursor.getString(2),cursor.getInt(3),cursor.getLong(4)))}}
    fun get(id: String): SavedDeck? = readableDatabase.rawQuery("SELECT id,name,format,deck_text,source_url,updated FROM decks WHERE id=?",arrayOf(id)).use {c ->if(c.moveToFirst()) SavedDeck(c.getString(0),c.getString(1),c.getString(2),c.getString(3),c.getString(4),c.getLong(5)) else null}
    fun save(id: String?,name: String,format: String,text: String,sourceUrl: String=""): SavedDeck {
        val title=name.trim()
        require(title.length in 1..120) {"Give the deck a name of 1–120 characters."}
        require(format in DeckText.formats) {"Choose a supported format."}
        require(text.isNotBlank() && text.length<=200000) {"A saved deck needs text of up to 200 KB."}
        require(sourceUrl.length<=2000) {"The source link is too long."}
        val now=System.currentTimeMillis();val key=id ?: UUID.randomUUID().toString()
        if(id!=null) require(get(id)!=null) {"That saved deck no longer exists. Use Save as new."}
        val values=ContentValues().apply {put("name",title);put("format",format);put("deck_text",text);put("source_url",sourceUrl);put("card_count",DeckText.parse(text).cards.sumOf {it.quantity});put("updated",now)}
        try {
            if(id==null) {values.put("id",key);values.put("created",now);writableDatabase.insertOrThrow("decks",null,values)}
            else writableDatabase.update("decks",values,"id=?",arrayOf(id))
        } catch(_:SQLiteConstraintException) {throw IllegalArgumentException("A saved $format deck named '$title' already exists. Choose another name, or load it and update its saved copy.")}
        DeckLibraryEvents.changed()
        return get(key)!!
    }
    fun rename(id: String,name: String): SavedDeck {val old=get(id) ?: error("Saved deck not found.");return save(id,name,old.format,old.text,old.sourceUrl)}
    fun delete(id: String): Boolean {val deleted=writableDatabase.delete("decks","id=?",arrayOf(id))>0;if(deleted) DeckLibraryEvents.changed();return deleted}
}

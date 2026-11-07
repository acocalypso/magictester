package com.acocalypso.magictester

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class DeckLibraryTest {
    private fun isolated(): Context {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(base.cacheDir,"deck-library-${UUID.randomUUID()}").apply {mkdirs()}
        return object: ContextWrapper(base) {
            override fun getFilesDir()=folder
            override fun getDatabasePath(name: String)=File(folder,name)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name),factory)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?,handler: DatabaseErrorHandler?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path,factory,handler)
        }
    }
    @Test fun namedDeckKeepsCommanderSectionsAndSourceAcrossDatabaseReopen() {
        val context=isolated();var library=DeckLibrary(context)
        val text="Commander\n1 Ravos, Soultender\n1 Tymna the Weaver\nDeck\n97 Plains\n1 Brightclimb Pathway // Grimclimb Pathway\n"
        val source="https://moxfield.com/decks/gJFmgkq120Srp4FL8EghPw"
        try {
            val saved=library.save(null,"Counter Intelligence","commander",text,source)
            assertEquals(100,library.all().single().cardCount)
            library.close();library=DeckLibrary(context)
            assertEquals(text,library.get(saved.id)!!.text);assertEquals(source,library.get(saved.id)!!.sourceUrl)
            assertEquals("commander",library.get(saved.id)!!.format)
            assertEquals(2,DeckText.parse(library.get(saved.id)!!.text).cards.count {it.section=="Commander"})
            val edited=text+"\nSideboard\n1 Pyroblast\n"
            val updated=library.save(saved.id,"Edited list","commander",edited,source)
            assertEquals(saved.id,updated.id);assertEquals(1,library.all().size)
            assertEquals(edited,library.get(saved.id)!!.text)
            library.rename(saved.id,"Final name")
            assertEquals("Final name",library.get(saved.id)!!.name)
            assertEquals(edited,library.get(saved.id)!!.text)
            assertTrue(library.delete(saved.id));assertNull(library.get(saved.id));assertTrue(library.all().isEmpty())
        } finally {library.close()}
    }
    @Test fun draftsNeedNoEngineAndDuplicateNamesCannotReplaceAnotherSavedDeck() {
        val library=DeckLibrary(isolated())
        try {
            val saved=library.save(null,"Draft","pauper","An unfinished decklist")
            assertEquals(0,library.all().single().cardCount)
            assertEquals("An unfinished decklist",library.get(saved.id)!!.text)
            try {library.save(null,"draft","pauper","Different text");fail("Duplicate names must not overwrite a saved deck")}
            catch(error:IllegalArgumentException) {assertTrue(error.message.orEmpty().contains("already exists"))}
            assertEquals("An unfinished decklist",library.get(saved.id)!!.text)
            library.save(null,"Draft","commander","1 Plains")
            assertEquals(2,library.all().size)
        } finally {library.close()}
    }
}

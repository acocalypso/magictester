package com.acocalypso.magictester

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable fun DeckLibraryDialog(model: Workbench,onLoad: (String)->Unit,onDismiss: ()->Unit) {
    var pendingLoad by remember {mutableStateOf<String?>(null)}
    var pendingDelete by remember {mutableStateOf<SavedDeckSummary?>(null)}
    var pendingRename by remember {mutableStateOf<SavedDeckSummary?>(null)}
    var newName by remember {mutableStateOf("")}
    AlertDialog(onDismissRequest=onDismiss,title={Text("Saved decks")},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text("Stored on this device. Loading restores the list and format; checking or running a deck is a separate action.",fontSize=12.sp)
        if(model.savedDecks.isEmpty()) Text("No saved decks yet. Add a name and decklist in Test, then choose Save deck.")
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=440.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            items(model.savedDecks,key={it.id}) {deck ->
                OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    Text(deck.name,fontSize=16.sp)
                    Text("${deck.format} · ${if(deck.cardCount==0) "draft text" else "${deck.cardCount} cards"}",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Row {
                        TextButton(onClick={if(model.hasUnsavedDeck) pendingLoad=deck.id else onLoad(deck.id)},enabled=!model.busy,modifier=Modifier.testTag("load-saved-deck-${deck.id}")) {Text("Load")}
                        TextButton(onClick={pendingRename=deck;newName=deck.name},enabled=!model.busy,modifier=Modifier.testTag("rename-saved-deck-${deck.id}")) {Text("Rename")}
                        TextButton(onClick={pendingDelete=deck},enabled=!model.busy,modifier=Modifier.testTag("delete-saved-deck-${deck.id}")) {Text("Delete")}
                    }
                }}
            }
        }
    }},confirmButton={TextButton(onClick=onDismiss) {Text("Close")}})
    pendingLoad?.let {id ->AlertDialog(onDismissRequest={pendingLoad=null},title={Text("Replace current draft?")},text={Text("The current draft has changes outside the saved library. Save it first if you want to keep them.")},confirmButton={TextButton(onClick={pendingLoad=null;onLoad(id)}) {Text("Load deck")}},dismissButton={TextButton(onClick={pendingLoad=null}) {Text("Keep editing")}})}
    pendingRename?.let {deck ->AlertDialog(onDismissRequest={pendingRename=null},title={Text("Rename saved deck")},text={OutlinedTextField(newName,{newName=it},label={Text("Saved deck name")},singleLine=true)},confirmButton={TextButton(onClick={model.renameSavedDeck(deck.id,newName);pendingRename=null},enabled=newName.isNotBlank() && !model.busy) {Text("Rename")}},dismissButton={TextButton(onClick={pendingRename=null}) {Text("Cancel")}})}
    pendingDelete?.let {deck ->AlertDialog(onDismissRequest={pendingDelete=null},title={Text("Delete saved deck?")},text={Text("Delete '${deck.name}' from the library? Your current draft and past analysis evidence are kept.")},confirmButton={TextButton(onClick={model.deleteSavedDeck(deck.id);pendingDelete=null},enabled=!model.busy) {Text("Delete saved deck")}},dismissButton={TextButton(onClick={pendingDelete=null}) {Text("Keep")}})}
}

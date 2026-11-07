/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Bounded, opt-in observations of native controller choices. Never changes a choice. */
public final class DecisionJournal {
    public static final int MAX_RECORDS=128, MAX_BYTES=262144, MAX_OPTIONS=128;
    private static final Gson JSON=new GsonBuilder().serializeNulls().create();
    private final List<JsonObject> records=new ArrayList<>();
    private final int seed;
    private long attempted, dropped, pending;
    private int bytes,reservedBytes;
    private boolean closed;
    private Map<String,Object> terminal;
    public DecisionJournal(int seed) {this.seed=seed;}

    public final class Choice {
        private final JsonObject record;
        private final Set<String> options;
        private final boolean optional;
        private final int reserved;
        private final long started=System.nanoTime();
        private boolean completed;
        private Choice(JsonObject record,Set<String> options,boolean optional,int reserved) {
            this.record=record;this.options=options;this.optional=optional;this.reserved=reserved;
        }
        public void complete(String selected) {
            synchronized(DecisionJournal.this) {
                if(completed) return;
                completed=true;pending--;reservedBytes-=reserved;
                if(closed) return;
                if(selected!=null && selected.length()>96) {dropped++;return;}
                record.addProperty("durationNanos",Math.max(0,System.nanoTime()-started));
                record.addProperty("selected",selected);
                record.addProperty("selectionValid",selected==null ? optional : options.contains(selected));
                int size=JSON.toJson(record).getBytes(StandardCharsets.UTF_8).length;
                if(records.size()>=MAX_RECORDS || bytes+size>MAX_BYTES) {dropped++;return;}
                records.add(record);bytes+=size;
            }
        }
        public void failed() {synchronized(DecisionJournal.this) {if(!completed) {completed=true;pending--;reservedBytes-=reserved;dropped++;}}}
    }
    public synchronized Choice begin(Map<String,Object> observation,List<Map<String,Object>> options,boolean optional) {
        if(closed) return null;
        long id=attempted++;
        if(options.size()>MAX_OPTIONS || records.size()+pending>=MAX_RECORDS || bytes+reservedBytes>=MAX_BYTES) {dropped++;return null;}
        Set<String> ids=new HashSet<>();
        for(Map<String,Object> option:options) {
            Object key=option.get("id");
            if(!(key instanceof String) || ((String)key).length()>96 || !ids.add((String)key)) {dropped++;return null;}
        }
        JsonObject record=new JsonObject();record.addProperty("id",id);
        record.addProperty("kind","entity_choice");record.addProperty("optional",optional);
        // Serializing now freezes the observation before the controller can mutate game state.
        record.add("observation",JSON.toJsonTree(observation));record.add("options",JSON.toJsonTree(options));
        record.addProperty("choiceSemantics","native_controller_return");
        record.addProperty("applicationToGame","not_verified_by_this_hook");
        int reserved=JSON.toJson(record).getBytes(StandardCharsets.UTF_8).length+512;
        if(bytes+reservedBytes+reserved>MAX_BYTES) {dropped++;return null;}
        pending++;reservedBytes+=reserved;return new Choice(record,ids,optional,reserved);
    }
    public synchronized boolean canCapture() {return !closed && records.size()+pending<MAX_RECORDS && bytes+reservedBytes<MAX_BYTES;}
    public synchronized void dropped() {if(!closed) {attempted++;dropped++;}}
    public synchronized Map<String,Object> finish(boolean gameEnded) {
        if(terminal==null) {
            closed=true;
            List<JsonObject> copy=new ArrayList<>();for(JsonObject r:records) copy.add(r.deepCopy());
            copy.sort(Comparator.comparingLong(r->r.get("id").getAsLong()));
            Map<String,Object> out=new LinkedHashMap<>();out.put("schemaVersion",1);out.put("gameSeed",seed);
            out.put("coveredChoices",List.of("entity_choice"));out.put("otherChoicesRecorded",false);
            out.put("observationKind","actor_visible_features");out.put("fullStateReplay",false);
            out.put("attempted",attempted);out.put("dropped",dropped);out.put("pending",pending);
            out.put("completeForCoveredChoices",gameEnded && dropped==0 && pending==0);
            out.put("bytes",bytes);out.put("records",copy);terminal=out;
        }
        Map<String,Object> result=new LinkedHashMap<>(terminal);
        List<JsonObject> copy=new ArrayList<>();
        for(Object r:(List<?>)terminal.get("records")) copy.add(((JsonObject)r).deepCopy());
        result.put("records",copy);return result;
    }
}

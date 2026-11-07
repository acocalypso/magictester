/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.DecisionJournal;
import com.google.gson.*;
import java.util.*;

public final class DecisionJournalContracts {
    static void check(boolean ok,String message) {if(!ok) throw new AssertionError(message);}
    public static void main(String[] args) {
        var journal=new DecisionJournal(123);
        Map<String,Object> state=new LinkedHashMap<>();state.put("life",20);
        Map<String,Object> option=new LinkedHashMap<>();option.put("id","card:1");option.put("name","Before");
        var choice=journal.begin(state,List.of(option),false);
        state.put("life",1);option.put("name","After");choice.complete("card:1");choice.complete("card:1");
        var out=journal.finish(true);String json=new Gson().toJson(out);
        check(json.contains("Before")&&!json.contains("After"),"Snapshot must precede caller mutation");
        check(json.contains("\"life\":20"),"Life must be frozen before choice");
        check(((List<?>)out.get("records")).size()==1,"Completion is exactly once");
        check((Boolean)out.get("completeForCoveredChoices"),"Complete scoped trace expected");
        check(journal.begin(state,List.of(option),false)==null,"Closed journals must not revive");
        var partial=new DecisionJournal(1);var outstanding=partial.begin(state,List.of(option),true);
        check(!(Boolean)partial.finish(false).get("completeForCoveredChoices"),"Pending/interrupted capture must be partial");
        outstanding.complete(null);
        check(!(Boolean)partial.finish(true).get("completeForCoveredChoices"),"Late callbacks cannot rewrite frozen evidence");
        var capped=new DecisionJournal(2);
        for(int i=0;i<DecisionJournal.MAX_RECORDS+10;i++) {var c=capped.begin(state,List.of(option),true);if(c!=null)c.complete(null);}
        var cap=capped.finish(true);check(((List<?>)cap.get("records")).size()==DecisionJournal.MAX_RECORDS,"Record cap");
        check(((Number)cap.get("dropped")).longValue()==10,"Dropped choices counted");
        var invalid=new DecisionJournal(3);invalid.begin(state,List.of(option),false).complete("missing");
        var record=(JsonObject)((List<?>)invalid.finish(true).get("records")).get(0);
        check(!record.get("selectionValid").getAsBoolean(),"Nonmember return cannot be a valid training label");
        var large=new DecisionJournal(4);var huge=Map.<String,Object>of("blob","x".repeat(DecisionJournal.MAX_BYTES));
        check(large.begin(huge,List.of(option),true)==null,"Oversized pre-choice snapshots are rejected before retention");
        check(((List<?>)large.finish(true).get("records")).isEmpty(),"Byte cap applies to encoded records");
        var duplicates=new DecisionJournal(5);check(duplicates.begin(state,List.of(option,option),false)==null,"Ambiguous option IDs rejected");
        var inflight=new DecisionJournal(6);
        List<DecisionJournal.Choice> pending=new ArrayList<>();
        for(int i=0;i<DecisionJournal.MAX_RECORDS;i++) pending.add(inflight.begin(state,List.of(option),true));
        check(inflight.begin(state,List.of(option),true)==null,"In-flight snapshots count toward capacity");
        for(var c:pending) {check(c!=null,"Bounded small fixture fits capacity");c.failed();c.failed();}
        var failures=inflight.finish(true);
        check(((Number)failures.get("pending")).longValue()==0,"Failed callbacks release reservations exactly once");
        check(((Number)failures.get("dropped")).longValue()==DecisionJournal.MAX_RECORDS+1,"Failures remain explicit");
        ((List<?>)out.get("records")).clear();
        check(((List<?>)journal.finish(true).get("records")).size()==1,"Consumers cannot mutate frozen journal evidence");
        System.out.println("Decision journal contracts passed");
    }
}

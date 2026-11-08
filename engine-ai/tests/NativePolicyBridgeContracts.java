/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.engine.AndroidForgeBridge;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Tiny engine-only games verify policy transport, not format legality or playing strength. */
public final class NativePolicyBridgeContracts {
    static void check(boolean ok,String message) {if(!ok)throw new AssertionError(message);}
    static JsonObject execute(JsonObject request) {
        List<JsonObject> events=new ArrayList<>();
        AndroidForgeBridge.execute(request.toString(),s->events.add(JsonParser.parseString(s).getAsJsonObject()));
        return events.stream().filter(e->e.get("type").getAsString().equals("result")).findFirst()
            .orElseThrow(()->new AssertionError(events.toString())).getAsJsonObject("result");
    }
    public static void main(String[] args)throws Exception {
        AndroidForgeBridge.initialize(args[0],s->{});
        Path directory=Files.createTempDirectory("policy-bridge-");
        try {
            var first=directory.resolve("first.dck");var second=directory.resolve("second.dck");
            Files.writeString(first,"[metadata]\nName=Policy contract A\n[Main]\n12 Mountain\n");
            Files.writeString(second,"[metadata]\nName=Policy contract B\n[Main]\n12 Island\n");
            var request=new JsonObject();var decks=new JsonArray();decks.add(first.toString());decks.add(second.toString());request.add("decks",decks);
            request.addProperty("mode","constructed");request.addProperty("games",1);request.addProperty("seed",191919);request.addProperty("clockSeconds",30);
            var old=execute(request);check(old.get("termination").getAsString().equals("normal"),"Default game completes: "+old.get("termination"));
            var stable=old.getAsJsonObject("ai").getAsJsonArray("seats");
            check(stable.get(0).getAsJsonObject().get("id").getAsString().equals("stable"),"Missing setting uses stable");
            var policies=new JsonArray();policies.add("tactical-v1");policies.add("stable");request.add("aiPolicies",policies);
            var candidate=execute(request);check(candidate.get("termination").getAsString().equals("normal"),"Candidate game completes: "+candidate.get("termination"));
            var selected=candidate.getAsJsonObject("ai").getAsJsonArray("seats");
            check(selected.get(0).getAsJsonObject().get("id").getAsString().equals("tactical-v1"),"Candidate seat saved");
            check(selected.get(1).getAsJsonObject().get("id").getAsString().equals("stable"),"Opponent remains reference");
            check(old.get("winner").equals(candidate.get("winner")) && old.get("turns").equals(candidate.get("turns")),"No-damage fixture retains native winner/turn count");
            check(!old.has("decisionTrace")&&!candidate.has("decisionTrace"),"Decision trace remains opt in");
            System.out.println("Native policy bridge contracts passed: two completed real games");
        } finally {
            try(var files=Files.list(directory)) {for(var file:files.toList()) Files.delete(file);}Files.delete(directory);
        }
        System.exit(0);
    }
}

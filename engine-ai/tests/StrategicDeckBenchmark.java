/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.engine.AndroidForgeBridge;
import com.google.gson.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Reproducible paired native games from local Forge deck files; no private deck text in reports. */
public final class StrategicDeckBenchmark {
    static final Gson JSON=new GsonBuilder().setPrettyPrinting().create();
    static String digest(String value)throws Exception {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
    static JsonObject run(JsonObject request) {
        List<JsonObject> events=new ArrayList<>();
        AndroidForgeBridge.execute(request.toString(),s->events.add(JsonParser.parseString(s).getAsJsonObject()));
        return events.stream().filter(e->"result".equals(e.get("type").getAsString())).findFirst()
            .orElseThrow(()->new IllegalStateException("No result: "+events)).getAsJsonObject("result");
    }
    static List<String> actions(JsonObject result) {
        List<String> signature=new ArrayList<>();
        for(var item:result.getAsJsonObject("actionLog").getAsJsonArray("entries")) {
            var e=item.getAsJsonObject();String text=e.get("text").getAsString();
            if(text.startsWith("Match Duration "))continue;
            signature.add(e.get("turn")+"|"+e.get("kind").getAsString()+"|"+text.replaceAll(" \\([0-9]+\\)",""));
        }
        return signature;
    }
    static Map<String,Object> brief(JsonObject result,List<String> actions)throws Exception {
        Map<String,Object> output=new LinkedHashMap<>();
        for(String key:List.of("termination","winner","turns","durationMs","gameSeed","clockSeconds")) output.put(key,result.get(key));
        output.put("actionSignatureSha256",digest(String.join("\n",actions)));
        output.put("ai",result.getAsJsonObject("ai"));return output;
    }
    public static void main(String[] args)throws Exception {
        if(args.length!=3)throw new IllegalArgumentException("Usage: StrategicDeckBenchmark FORGE_HOME CONFIG_JSON REPORT_JSON");
        var config=JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonObject();
        int count=config.get("games").getAsInt();if(count<1 || count>200)throw new IllegalArgumentException("Benchmark needs 1–200 matches");
        AndroidForgeBridge.initialize(args[0],s->{});
        var opponents=config.getAsJsonArray("opponents");List<Map<String,Object>> results=new ArrayList<>();
        int baselineWins=0,candidateWins=0,changed=0,completePairs=0;
        for(int index=0;index<count;index++) {
            var opponent=opponents.get(index%opponents.size()).getAsJsonObject();
            var request=new JsonObject();var decks=new JsonArray();decks.add(config.get("deck").getAsString());decks.add(opponent.get("deck").getAsString());request.add("decks",decks);
            request.addProperty("mode","constructed");request.addProperty("games",count);request.addProperty("seed",config.get("seed").getAsInt());
            request.addProperty("clockSeconds",config.get("clockSeconds").getAsInt());var indices=new JsonArray();indices.add(index);request.add("indices",indices);
            var policies=new JsonArray();policies.add("stable");policies.add("stable");request.add("aiPolicies",policies);var baseline=run(request);
            policies.set(0,new JsonPrimitive("strategic-v1"));var candidate=run(request);
            var baselineActions=actions(baseline);var candidateActions=actions(candidate);boolean differs=!baselineActions.equals(candidateActions);
            if(differs)changed++;
            boolean normal=Set.of("normal","rule_draw").contains(baseline.get("termination").getAsString()) && Set.of("normal","rule_draw").contains(candidate.get("termination").getAsString());
            if(normal) {
                completePairs++;
                if(!baseline.get("winner").isJsonNull() && baseline.get("winner").getAsInt()==0)baselineWins++;
                if(!candidate.get("winner").isJsonNull() && candidate.get("winner").getAsInt()==0)candidateWins++;
            }
            Map<String,Object> row=new LinkedHashMap<>();row.put("index",index);row.put("opponent",opponent.get("name").getAsString());row.put("changedActions",differs);
            row.put("baseline",brief(baseline,baselineActions));row.put("candidate",brief(candidate,candidateActions));
            if(differs)for(int i=0;i<Math.min(baselineActions.size(),candidateActions.size());i++)if(!baselineActions.get(i).equals(candidateActions.get(i))) {
                row.put("firstDifference",Map.of("baseline",baselineActions.get(i),"candidate",candidateActions.get(i)));break;
            }
            results.add(row);
            System.out.println("Pair "+(index+1)+"/"+count+": "+opponent.get("name").getAsString()+" changed="+differs+" winners="+baseline.get("winner")+"/"+candidate.get("winner"));
        }
        var summary=new LinkedHashMap<String,Object>();summary.put("policy","strategic-v1");summary.put("engineVersion","2.0.15");summary.put("seed",config.get("seed"));summary.put("pairs",count);summary.put("finishedPairs",completePairs);
        summary.put("baselineWins",baselineWins);summary.put("candidateWins",candidateWins);summary.put("changedActionPairs",changed);summary.put("results",results);
        summary.put("interpretation","Small fixed-seat deck/pool sample, not evidence of general AI strength. Durations include host load and are not a device performance benchmark.");
        Files.writeString(Path.of(args[2]),JSON.toJson(summary));System.exit(completePairs==count?0:2);
    }
}

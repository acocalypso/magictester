/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.engine.AndroidForgeBridge;
import com.google.gson.*;
import forge.deck.DeckSection;
import forge.deck.io.DeckSerializer;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Head-to-head league worker: two AI policies swap decks so neither is helped by its list.
 *
 * Every pairing of two decks is played as a mirrored pair with one seed. In the first leg the
 * candidate pilots deck A against the baseline on deck B; in the second leg they exchange decks.
 * A policy that is merely handed the better deck wins one leg and loses the other. Rows are written
 * one per leg as JSON lines so an interrupted run keeps what it finished. Unfinished legs are kept
 * and labelled; nothing is dropped or guessed. Use engine-ai/tools/league.py to run and summarize.
 */
public final class AiLeague {
    static JsonObject run(JsonObject request) {
        List<JsonObject> events=new ArrayList<>();
        AndroidForgeBridge.execute(request.toString(),s->events.add(JsonParser.parseString(s).getAsJsonObject()));
        for(JsonObject event:events)if("result".equals(event.get("type").getAsString()))return event.getAsJsonObject("result");
        JsonObject failed=new JsonObject();failed.addProperty("termination","engine_error");failed.add("winner",JsonNull.INSTANCE);
        failed.addProperty("detail",events.isEmpty()?"no events":events.get(events.size()-1).toString());return failed;
    }
    static void validate(String name,String path) {
        var deck=DeckSerializer.fromFile(new File(path));
        if(deck==null)throw new IllegalArgumentException("Cannot read deck "+name+": "+path);
        int main=deck.getMain().countAll(),side=deck.has(DeckSection.Sideboard)?deck.get(DeckSection.Sideboard).countAll():0;
        if(main!=60 || side!=15)throw new IllegalArgumentException(name+" must have 60 main and 15 sideboard cards that the pinned Forge knows; found "+main+"/"+side);
    }
    static JsonObject game(JsonObject result,int candidateSeat) {
        JsonObject row=new JsonObject();
        for(String key:List.of("termination","winner","turns","durationMs","startingPlayer"))row.add(key,result.has(key)?result.get(key):JsonNull.INSTANCE);
        if(result.has("sideboardChanges") && result.get("sideboardChanges").isJsonArray()) for(var item:result.getAsJsonArray("sideboardChanges")) {
            var change=item.getAsJsonObject();String side=change.get("player").getAsInt()==candidateSeat?"candidate":"baseline";
            row.add(side+"In",change.get("added"));row.add(side+"Out",change.get("removed"));
        }
        if(result.has("ai")) for(var item:result.getAsJsonObject("ai").getAsJsonArray("seats")) {
            var seat=item.getAsJsonObject();
            row.add(seat.get("seat").getAsInt()==candidateSeat?"candidateNotes":"baselineNotes",seat.get("evaluationSuggestions"));
            row.addProperty(seat.get("seat").getAsInt()==candidateSeat?"candidatePolicy":"baselinePolicy",seat.get("id").getAsString());
        }
        return row;
    }
    public static void main(String[] args)throws Exception {
        if(args.length!=5)throw new IllegalArgumentException("Usage: AiLeague FORGE_HOME CONFIG_JSON ROWS_JSONL SHARD SHARDS");
        var config=JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonObject();
        Path base=Path.of(args[1]).toAbsolutePath().getParent();
        int shard=Integer.parseInt(args[3]),shards=Integer.parseInt(args[4]);
        String candidate=config.get("candidate").getAsString(),baseline=config.get("baseline").getAsString();
        int bestOf=config.get("bestOf").getAsInt(),repeats=config.get("repeats").getAsInt(),seed=config.get("seed").getAsInt(),clock=config.get("clockSeconds").getAsInt();
        AndroidForgeBridge.initialize(args[0],s->{});
        List<String> names=new ArrayList<>(),paths=new ArrayList<>();
        for(var item:config.getAsJsonArray("decks")) {
            var deck=item.getAsJsonObject();String path=base.resolve(deck.get("deck").getAsString()).toString();
            validate(deck.get("name").getAsString(),path);names.add(deck.get("name").getAsString());paths.add(path);
        }
        int unit=0;
        try(var out=new PrintWriter(Files.newBufferedWriter(Path.of(args[2]),StandardCharsets.UTF_8))) {
            for(int a=0;a<names.size();a++)for(int b=a+1;b<names.size();b++)for(int repeat=0;repeat<repeats;repeat++,unit++) {
                if(unit%shards!=shard)continue;
                int pairSeed=(int)(((long)seed+(long)unit*7919L)%2147483647L);
                for(int candidateSeat=0;candidateSeat<2;candidateSeat++) {
                    var request=new JsonObject();var decks=new JsonArray();decks.add(paths.get(a));decks.add(paths.get(b));request.add("decks",decks);
                    request.addProperty("mode","constructed");request.addProperty("games",1);request.addProperty("seed",pairSeed);request.addProperty("clockSeconds",clock);
                    request.addProperty("bestOf",bestOf);request.addProperty("sideboarding",bestOf==3);request.addProperty("maxMatchGames",5);
                    var policies=new JsonArray();policies.add(candidateSeat==0?candidate:baseline);policies.add(candidateSeat==1?candidate:baseline);request.add("aiPolicies",policies);
                    JsonObject result;
                    try {result=run(request);}
                    catch(RuntimeException error) {result=new JsonObject();result.addProperty("termination","engine_error");result.add("winner",JsonNull.INSTANCE);result.addProperty("detail",error.toString());}
                    JsonObject row=new JsonObject();
                    row.addProperty("unit",unit);row.addProperty("deckA",names.get(a));row.addProperty("deckB",names.get(b));row.addProperty("repeat",repeat);
                    row.addProperty("seed",pairSeed);row.addProperty("candidateSeat",candidateSeat);row.addProperty("candidateDeck",names.get(candidateSeat==0?a:b));
                    row.addProperty("baselineDeck",names.get(candidateSeat==0?b:a));row.addProperty("bestOf",bestOf);
                    row.add("termination",result.get("termination"));row.add("winner",result.has("winner")?result.get("winner"):JsonNull.INSTANCE);
                    row.add("durationMs",result.has("durationMs")?result.get("durationMs"):JsonNull.INSTANCE);
                    if(result.has("detail"))row.add("detail",result.get("detail"));
                    var games=new JsonArray();
                    if(result.has("games"))for(var item:result.getAsJsonArray("games"))games.add(game(item.getAsJsonObject(),candidateSeat));
                    else if(result.has("ai"))games.add(game(result,candidateSeat));
                    row.add("games",games);
                    out.println(row);out.flush();
                    System.out.println("shard "+shard+" unit "+unit+" "+names.get(a)+" vs "+names.get(b)+" candidateSeat="+candidateSeat+" "+result.get("termination")+" winner="+row.get("winner"));
                }
            }
        }
        System.exit(0);
    }
}

/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.*;
import org.magictester.engine.AndroidForgeBridge;
import forge.ai.SpellApiToAi;
import forge.game.*;
import forge.game.card.*;
import forge.game.player.*;
import forge.game.phase.PhaseType;
import forge.game.zone.ZoneType;
import forge.game.ability.AbilityFactory;
import forge.deck.*;
import forge.player.GamePlayerUtil;
import forge.StaticData;
import com.google.gson.*;
import java.util.*;
import java.nio.file.*;

/** Curated native decisions, rotated seats, legacy-policy parity and hidden-card permutations. */
public final class ExpandedTacticsContracts {
    static final Gson JSON=new GsonBuilder().setPrettyPrinting().create();
    static void check(boolean ok,String message) {if(!ok)throw new AssertionError(message);}
    static Card card(Player owner,String name,ZoneType zone) {
        var paper=StaticData.instance().getCommonCards().getCard(name);check(paper!=null,"Known fixture card: "+name);
        Card c=Card.fromPaperCard(paper,owner);owner.getZone(zone).add(c);return c;
    }
    static Map<String,Object> run(JsonObject f,String policy,int rotation,boolean hiddenVariant) {
        var roster=new ArrayList<RegisteredPlayer>();
        for(int i=0;i<4;i++) {var r=new RegisteredPlayer(new Deck("expanded-fixture"));r.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(r);}
        var rules=new GameRules(GameType.Commander);
        var game=new Match(rules,roster,"expanded-contract").createGame();
        List<Player> logical=new ArrayList<>();for(int i=0;i<4;i++) logical.add(game.getRegisteredPlayers().get((i+rotation)%4));
        Player actor=logical.get(0);game.getPhaseHandler().devModeSet(PhaseType.MAIN2,actor);
        for(int i=0;i<4;i++) {
            Player p=logical.get(i);p.setLife(f.has("life")?f.getAsJsonArray("life").get(i).getAsInt():40,null);
            int library=f.has("library")?f.getAsJsonArray("library").get(i).getAsInt():20;
            int hand=f.has("hand")?f.getAsJsonArray("hand").get(i).getAsInt():0;
            for(int n=0;n<library;n++) card(p,hiddenVariant?"Island":"Mountain",ZoneType.Library);
            for(int n=0;n<hand;n++) card(p,hiddenVariant?"Ancestral Recall":"Forest",ZoneType.Hand);
            if(f.has("poison")) p.setPoisonCounters(f.getAsJsonArray("poison").get(i).getAsInt(),actor);
        }
        if(f.has("permanents")) for(var entry:f.getAsJsonArray("permanents")) {
            var permanent=entry.getAsJsonObject();Card c=card(logical.get(permanent.get("seat").getAsInt()),permanent.get("name").getAsString(),ZoneType.Battlefield);
            if(permanent.has("attachTo")) c.setEntityAttachedTo(logical.get(permanent.get("attachTo").getAsInt()));
        }
        var source=card(actor,f.get("source").getAsString(),f.has("sourceZone")?ZoneType.valueOf(f.get("sourceZone").getAsString()):ZoneType.Hand);
        if(f.has("loyalty")) source.setCounters(CounterEnumType.LOYALTY,f.get("loyalty").getAsInt());
        forge.game.spellability.SpellAbility ability=null;
        if(f.has("printedApi")) {
            for(var option:source.getSpellAbilities()) if(option.getApi()!=null && option.getApi().name().equals(f.get("printedApi").getAsString())) {ability=option;break;}
            check(ability!=null,"Actual printed native ability exists: "+f.get("source"));
        } else ability=AbilityFactory.getAbility(f.get("ability").getAsString(),source);
        ability.setActivatingPlayer(actor);
        if(f.has("svars")) for(var entry:f.getAsJsonObject("svars").entrySet()) source.setSVar(entry.getKey(),entry.getValue().getAsString());
        if(f.has("paidX")) ability.setXManaCostPaid(f.get("paidX").getAsInt());
        game.getAction().checkStaticAbilities();
        String[] policies={"stable","stable","stable","stable"};policies[rotation]=policy;AiPolicies.open(game,policies);
        forge.util.MyRandom.setRandom(new Random(f.has("seed")?f.get("seed").getAsLong():90817));
        var ai=SpellApiToAi.Converter.get(ability);
        var decision=f.has("apiCheck") && f.get("apiCheck").getAsBoolean()?ai.canPlayWithSubs(actor,ability):ai.chkDrawback(actor,ability);
        List<String> targets=new ArrayList<>();
        for(var p:ability.getTargets().getTargetPlayers()) targets.add("seat-"+logical.indexOf(p));
        for(var c:ability.getTargets().getTargetCards()) targets.add(c.getName());
        var metadata=AiPolicies.close(game);
        return Map.of("targets",targets,"willPlay",decision.willingToPlay(),"ai",metadata);
    }
    public static void main(String[] args)throws Exception {
        AndroidForgeBridge.initialize(args[0],s->{});
        var fixtures=JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonArray();
        List<Map<String,Object>> results=new ArrayList<>();int assertions=0,changes=0;
        for(var value:fixtures) {
            var f=value.getAsJsonObject();String id=f.get("id").getAsString();
            for(int rotation=0;rotation<4;rotation++) {
                var baseline=run(f,"stable",rotation,false);var legacy=run(f,"tactical-v1",rotation,false);
                var candidate=run(f,"tactical-v2",rotation,false);var hidden=run(f,"tactical-v2",rotation,true);
                check(candidate.get("targets").equals(hidden.get("targets")) && candidate.get("willPlay").equals(hidden.get("willPlay")),id+": hidden identities must not affect choice");assertions++;
                if(!f.has("legacyMayDiffer")) {check(baseline.get("targets").equals(legacy.get("targets")) && baseline.get("willPlay").equals(legacy.get("willPlay")),id+": legacy policy changed");assertions++;}
                if(f.has("expected")) {
                    List<String> expected=new ArrayList<>();for(var target:f.getAsJsonArray("expected")) expected.add(target.getAsString());
                    check(expected.equals(candidate.get("targets")),id+" seat="+rotation+" expected="+expected+" actual="+candidate.get("targets"));assertions++;
                }
                if(f.has("willPlay")) {check(f.get("willPlay").getAsBoolean()==(Boolean)candidate.get("willPlay"),id+": willingness "+candidate);assertions++;}
                if(f.has("unchanged") && f.get("unchanged").getAsBoolean()) {check(candidate.get("targets").equals(baseline.get("targets")) && candidate.get("willPlay").equals(baseline.get("willPlay")),id+": unsupported scope must fall back");assertions++;}
                if(!candidate.get("targets").equals(baseline.get("targets")) || !candidate.get("willPlay").equals(baseline.get("willPlay")))changes++;
                results.add(Map.of("id",id,"actorSeat",rotation,"baseline",baseline,"candidate",candidate));
            }
        }
        if(args.length>2) Files.writeString(Path.of(args[2]),JSON.toJson(Map.of("schemaVersion",1,"engineVersion","2.0.16","policy","tactical-v2","scenarios",fixtures.size(),"positions",results.size(),"assertions",assertions,"changedPositions",changes,"fixtures",results)));
        System.out.println("Expanded tactics passed: "+fixtures.size()+" scenarios, "+results.size()+" rotated positions, "+assertions+" assertions, "+changes+" changed positions");System.exit(0);
    }
}

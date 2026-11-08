/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.*;
import org.magictester.engine.AndroidForgeBridge;
import forge.ai.ability.DamageDealAi;
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

/** Uses actual Forge card scripts, static effects and native damage targeting. */
public final class DamageTacticsContracts {
    static final Gson JSON=new GsonBuilder().setPrettyPrinting().create();
    static void check(boolean ok,String message) {if(!ok) throw new AssertionError(message);}
    static Card card(Player owner,String name,ZoneType zone) {
        var paper=StaticData.instance().getCommonCards().getCard(name);
        check(paper!=null,"Fixture card exists: "+name);
        Card c=Card.fromPaperCard(paper,owner);owner.getZone(zone).add(c);return c;
    }
    static Map<String,Object> run(JsonObject fixture,String policy) {
        var roster=new ArrayList<RegisteredPlayer>();
        var life=fixture.getAsJsonArray("life");
        for(int i=0;i<life.size();i++) {
            var r=new RegisteredPlayer(new Deck("damage-fixture"));
            r.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(r);
        }
        var game=new Match(new GameRules(life.size()>2?GameType.Commander:GameType.Constructed),roster,"damage-tactics").createGame();
        var actor=game.getRegisteredPlayers().get(0);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1,actor);
        for(int i=0;i<life.size();i++) game.getRegisteredPlayers().get(i).setLife(life.get(i).getAsInt(),null);
        if(fixture.has("permanents")) for(var value:fixture.getAsJsonArray("permanents")) {
            var permanent=value.getAsJsonObject();card(game.getRegisteredPlayers().get(permanent.get("seat").getAsInt()),permanent.get("name").getAsString(),ZoneType.Battlefield);
        }
        var source=card(actor,"Lightning Bolt",ZoneType.Hand);
        var ability=AbilityFactory.getAbility(fixture.has("ability")?fixture.get("ability").getAsString():
            "SP$ DealDamage | Cost$ R | ValidTgts$ Creature,Planeswalker,Player | TgtPrompt$ Select target | NumDmg$ 3 | SpellDescription$ Deal 3 damage to any target.",source);
        ability.setActivatingPlayer(actor);source.setSVar("X","Number$3");
        if(fixture.get("id").getAsString().equals("multi-target-fallback")) check(ability.getMaxTargets()==2,"Fixture really has two target slots");
        game.getAction().checkStaticAbilities();
        String[] policies=new String[life.size()];Arrays.fill(policies,AiPolicies.STABLE);policies[0]=policy;
        AiPolicies.open(game,policies);
        forge.util.MyRandom.setRandom(new Random(90817));
        var decision=new DamageDealAi().chkDrawback(actor,ability);
        List<String> targets=new ArrayList<>();
        for(var p:ability.getTargets().getTargetPlayers()) targets.add(p.getName());
        for(var c:ability.getTargets().getTargetCards()) targets.add(c.getName());
        var provenance=AiPolicies.close(game);
        check(!AiPolicies.tactical(actor),"Policy registration removed after game");
        return Map.of("targets",targets,"willPlay",decision.willingToPlay(),"ai",provenance);
    }
    public static void main(String[] args)throws Exception {
        AndroidForgeBridge.initialize(args[0],s->{});
        var fixtures=JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonArray();
        List<Map<String,Object>> results=new ArrayList<>();
        int assertions=0;
        for(var value:fixtures) {
            var fixture=value.getAsJsonObject();String id=fixture.get("id").getAsString();
            var baseline=run(fixture,AiPolicies.STABLE);var candidate=run(fixture,AiPolicies.TACTICAL);
            if(fixture.has("expectedCandidate")) {check(candidate.get("targets").equals(List.of(fixture.get("expectedCandidate").getAsString())),id+": "+candidate);assertions++;}
            if(fixture.has("expectedBaseline")) {check(baseline.get("targets").equals(List.of(fixture.get("expectedBaseline").getAsString())),id+" baseline: "+baseline);assertions++;}
            if(fixture.has("unchanged") && fixture.get("unchanged").getAsBoolean()) {
                check(baseline.get("targets").equals(candidate.get("targets")),id+": fallback must preserve native targets");
                check(baseline.get("willPlay").equals(candidate.get("willPlay")),id+": fallback must preserve willingness");assertions+=2;
            }
            results.add(Map.of("id",id,"baseline",baseline,"candidate",candidate));
        }
        if(args.length>2) Files.writeString(Path.of(args[2]),JSON.toJson(Map.of("schemaVersion",1,"engineVersion","2.0.15","seed",90817,"assertions",assertions,"fixtures",results)));
        System.out.println("Damage tactics passed: "+fixtures.size()+" native positions, "+assertions+" assertions");System.exit(0);
    }
}

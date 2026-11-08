/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.*;
import org.magictester.engine.AndroidForgeBridge;
import forge.ai.*;
import forge.game.*;
import forge.game.card.*;
import forge.game.combat.*;
import forge.game.player.*;
import forge.game.phase.PhaseType;
import forge.game.zone.ZoneType;
import forge.deck.*;
import forge.player.GamePlayerUtil;
import forge.StaticData;
import java.util.*;
import java.nio.file.*;
import com.google.gson.*;

/** Real printed cards through native hooks, bounded combat and information-isolation checks. */
public final class StrategicContracts {
    static int assertions=0;
    static final List<Map<String,Object>> evidence=new ArrayList<>();
    static void check(boolean value,String label) {assertions++;if(!value)throw new AssertionError(label);}
    record Position(Game game,Player actor,Player opponent) {}
    static Position position(String policy,boolean swapped) {
        return position(policy,swapped?1:0,GameType.Constructed,2);
    }
    static Position position(String policy,int seat,GameType format,int seats) {
        var roster=new ArrayList<RegisteredPlayer>();
        for(int i=0;i<seats;i++) {var p=new RegisteredPlayer(new Deck("strategy-fixture"));p.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(p);}
        var game=new Match(new GameRules(format),roster,"strategy-contract").createGame();
        game.setAge(GameStage.Play);
        Player actor=game.getRegisteredPlayers().get(seat),opponent=game.getRegisteredPlayers().get((seat+1)%seats);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1,actor);
        String[] policies=new String[seats];Arrays.fill(policies,"stable");policies[seat]=policy;AiPolicies.open(game,policies);
        return new Position(game,actor,opponent);
    }
    static void commander(int seat) {
        var p=position("strategic-v1",seat,GameType.Commander,4);library(p.actor);
        hand(p.actor,"Forest","Forest","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt");
        check(!p.actor.getController().mulliganKeepHand(p.actor,0),"Mana-aware hand decision also applies to Commander seat "+seat);
        var raider=card(p.actor,"Goblin Tomb Raider",ZoneType.Hand);card(p.actor,"Great Furnace",ZoneType.Battlefield);
        check(ComputerUtil.castPermanentInMain1(p.actor,raider.getSpellPermanent()),"Conditional haste sequencing applies to Commander seat "+seat);
        check(!AiPolicies.strategic(p.opponent),"Native opponents remain native in a multiplayer comparison");finish(p,"commander-seat-"+seat);
    }
    static Card card(Player p,String name,ZoneType zone) {
        var paper=StaticData.instance().getCommonCards().getCard(name);if(paper==null)throw new AssertionError("Printed card exists: "+name);
        var c=Card.fromPaperCard(paper,p);p.getZone(zone).add(c);c.setSickness(false);return c;
    }
    static void library(Player p) {for(int i=0;i<18;i++)card(p,"Mountain",ZoneType.Library);for(int i=0;i<36;i++)card(p,"Grizzly Bears",ZoneType.Library);}
    static void hand(Player p,String... names) {for(String n:names)card(p,n,ZoneType.Hand);}
    static void finish(Position p,String label) {evidence.add(Map.of("id",label,"ai",AiPolicies.close(p.game)));}
    static void mulligans(boolean swapped) {
        for(String policy:List.of("stable","tactical-v1","tactical-v2","strategic-v1")) {
            var p=position(policy,swapped);library(p.actor);
            hand(p.actor,"Mountain","Goblin Tomb Raider","Goblin Bushwhacker","Lightning Bolt","Voldaren Epicure","Clockwork Percussionist","Burning-Tree Emissary");
            boolean keep=p.actor.getController().mulliganKeepHand(p.actor,0);
            check(keep==policy.equals("strategic-v1"),"One-land low-curve keep is a strategic-only change: "+policy);
            finish(p,"one-land-aggro-"+policy);
        }
        var p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Forest","Forest","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt");
        check(!p.actor.getController().mulliganKeepHand(p.actor,0),"Reject a two-land hand with no access to its spell colors");finish(p,"color-screw");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Mountain","Forest","Ash Zealot","Ash Zealot","Ash Zealot","Ash Zealot","Ash Zealot");
        check(!p.actor.getController().mulliganKeepHand(p.actor,0),"Two lands with only one red source cannot pay double-red costs");finish(p,"double-pip-screw");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Wastes","Wastes","Wastes","Matter Reshaper","Matter Reshaper","Matter Reshaper","Matter Reshaper");
        check(p.actor.getController().mulliganKeepHand(p.actor,0),"Genuine colorless mana supports colorless-symbol costs");finish(p,"colorless-hand");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Mountain","Mountain","Mountain","Mountain","Goblin Tomb Raider","Lightning Bolt","Burning-Tree Emissary");
        var original=new CardCollection(p.actor.getCardsIn(ZoneType.Hand));
        var bottom=p.actor.getController().tuckCardsViaMulligan(original,2);
        check(bottom.size()==2 && bottom.get(0).isLand() && bottom.get(1).isLand(),"London search keeps two lands and the three playable spells");
        check(original.size()==7,"Search must not mutate the source hand");finish(p,"london-bottom");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Forest","Forest","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt");
        boolean nativeDecision=!ComputerUtil.wantMulligan(p.actor,2);
        check(p.actor.getController().mulliganKeepHand(p.actor,2)==nativeDecision,"Do not introduce a low-card mulligan loop");finish(p,"low-card-fallback");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Forest","Forest","Generous Ent","Lightning Bolt","Lightning Bolt","Lightning Bolt","Lightning Bolt");
        nativeDecision=!ComputerUtil.wantMulligan(p.actor,0);
        check(p.actor.getController().mulliganKeepHand(p.actor,0)==nativeDecision,"Landcycling and alternative faces retain native mulligans");finish(p,"alternate-resource-fallback");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Gaea's Cradle","Gaea's Cradle","Gaea's Cradle","Llanowar Elves","Llanowar Elves","Llanowar Elves","Llanowar Elves");
        nativeDecision=!ComputerUtil.wantMulligan(p.actor,0);
        check(p.actor.getController().mulliganKeepHand(p.actor,0)==nativeDecision,"Dynamic mana retains native hand evaluation");
        check(StrategicHand.bottom(p.actor,p.actor.getCardsIn(ZoneType.Hand),1)==null,"Dynamic mana retains native bottom selection");finish(p,"dynamic-mana-fallback");
        p=position("strategic-v1",swapped);library(p.actor);hand(p.actor,"Seat of the Synod","Seat of the Synod","Myr Enforcer","Myr Enforcer","Myr Enforcer","Myr Enforcer","Myr Enforcer");
        nativeDecision=!ComputerUtil.wantMulligan(p.actor,0);
        check(p.actor.getController().mulliganKeepHand(p.actor,0)==nativeDecision,"Affinity costs retain native hand evaluation");
        check(StrategicHand.bottom(p.actor,p.actor.getCardsIn(ZoneType.Hand),1)==null,"Affinity costs retain native bottom selection");finish(p,"affinity-cost-fallback");
        p=position("strategic-v1",swapped);library(p.actor);
        hand(p.actor,"Mountain","Goblin Tomb Raider","Goblin Bushwhacker","Lightning Bolt","Voldaren Epicure","Clockwork Percussionist","Burning-Tree Emissary");
        boolean before=p.actor.getController().mulliganKeepHand(p.actor,0);
        hand(p.opponent,"Black Lotus","Counterspell","Craw Wurm");
        check(before==p.actor.getController().mulliganKeepHand(p.actor,0),"Opponent hidden hand never changes opening-hand evaluation");finish(p,"hidden-hand-isolation");
    }
    static void sequencing(boolean swapped) {
        for(String policy:List.of("stable","tactical-v1","tactical-v2","strategic-v1")) {
            var p=position(policy,swapped);
            card(p.actor,"Great Furnace",ZoneType.Battlefield);var raider=card(p.actor,"Goblin Tomb Raider",ZoneType.Hand);
            p.game.getAction().checkStaticAbilities();
            boolean main1=ComputerUtil.castPermanentInMain1(p.actor,raider.getSpellPermanent());
            check(main1==policy.equals("strategic-v1"),"Recognize Tomb Raider's conditional haste before it enters: "+policy);
            finish(p,"conditional-haste-"+policy);
        }
        var p=position("strategic-v1",swapped);var raider=card(p.actor,"Goblin Tomb Raider",ZoneType.Hand);
        card(p.opponent,"Great Furnace",ZoneType.Battlefield);
        check(!StrategicSequencing.beforeCombat(p.actor,raider.getSpellPermanent()),"Opponent artifact does not grant haste");
        card(p.opponent,"Black Lotus",ZoneType.Hand);
        check(!StrategicSequencing.beforeCombat(p.actor,raider.getSpellPermanent()),"Opponent hidden hand does not affect timing");finish(p,"haste-own-board-only");
        p=position("strategic-v1",swapped);
        for(int i=0;i<4;i++)card(p.actor,"Mountain",ZoneType.Battlefield);
        var emissary=card(p.actor,"Burning-Tree Emissary",ZoneType.Hand);
        var bushwhacker=card(p.actor,"Goblin Bushwhacker",ZoneType.Hand);
        var epicure=card(p.actor,"Voldaren Epicure",ZoneType.Hand);
        check(ComputerUtil.castPermanentInMain1(p.actor,emissary.getSpellPermanent()),"Mana-refund creature available before combat");
        check(ComputerUtil.castPermanentInMain1(p.actor,epicure.getSpellPermanent()),"Creature may be deployed before team haste");
        java.util.List<forge.game.spellability.SpellAbility> choices=new ArrayList<>(List.of(bushwhacker.getSpellPermanent(),epicure.getSpellPermanent()));
        StrategicSequencing.order(p.actor,choices);
        check(choices.get(0).getHostCard()==epicure,"Team haste follows its affordable setup creature");
        p.game.getPhaseHandler().devModeSet(PhaseType.MAIN2,p.actor);
        choices=new ArrayList<>(List.of(bushwhacker.getSpellPermanent(),epicure.getSpellPermanent()));StrategicSequencing.order(p.actor,choices);
        check(choices.get(0).getHostCard()==bushwhacker,"Postcombat priorities remain native");finish(p,"team-haste-order");
        p=position("strategic-v1",swapped);card(p.actor,"Mountain",ZoneType.Battlefield);
        bushwhacker=card(p.actor,"Goblin Bushwhacker",ZoneType.Hand);epicure=card(p.actor,"Voldaren Epicure",ZoneType.Hand);
        check(!StrategicSequencing.beforeCombat(p.actor,epicure.getSpellPermanent()),"Do not spend a haste finisher's reserved mana");finish(p,"haste-budget");
    }
    static void combat(boolean swapped) {
        var p=position("strategic-v1",swapped);p.opponent.setLife(3,null);
        card(p.actor,"Hill Giant",ZoneType.Battlefield);card(p.actor,"Grizzly Bears",ZoneType.Battlefield);card(p.actor,"Grizzly Bears",ZoneType.Battlefield);
        card(p.opponent,"Grizzly Bears",ZoneType.Battlefield);p.game.getAction().checkStaticAbilities();
        var combat=new Combat(p.actor);StrategicCombat.attack(p.actor,combat);
        check(combat.getAttackers().size()==3,"Find lethal through the opponent's best single blocks");
        check(CombatUtil.validateAttackers(combat),"Attack remains legal");finish(p,"guaranteed-lethal");
        p=position("strategic-v1",swapped);p.actor.setLife(5,null);
        var wurm=card(p.opponent,"Craw Wurm",ZoneType.Battlefield);var enemyBear=card(p.opponent,"Grizzly Bears",ZoneType.Battlefield);
        var bear=card(p.actor,"Grizzly Bears",ZoneType.Battlefield);var giant=card(p.actor,"Hill Giant",ZoneType.Battlefield);
        p.game.getAction().checkStaticAbilities();combat=new Combat(p.opponent);combat.addAttacker(wurm,p.actor);combat.addAttacker(enemyBear,p.actor);
        StrategicCombat.block(p.actor,combat);
        check(combat.getBlockers(wurm).contains(bear),"Use the cheaper chump to prevent lethal");
        check(combat.getBlockers(enemyBear).contains(giant),"Surviving blocker kills the small attacker");
        check(CombatUtil.validateBlocks(combat,p.actor)==null,"Block assignment remains legal");finish(p,"bounded-blocking");
        p=position("strategic-v1",swapped);p.opponent.setLife(1,null);
        var striker=card(p.actor,"Fencing Ace",ZoneType.Battlefield);p.game.getAction().checkStaticAbilities();combat=new Combat(p.actor);
        StrategicCombat.attack(p.actor,combat);check(combat.getAttackers().isEmpty(),"Double-strike combat falls back to native logic");finish(p,"complex-combat-fallback");
    }
    public static void main(String[] args)throws Exception {
        AndroidForgeBridge.initialize(args[0],s->{});
        for(boolean swapped:new boolean[]{false,true}) {mulligans(swapped);sequencing(swapped);combat(swapped);}
        for(int seat=0;seat<4;seat++)commander(seat);
        if(args.length>1)Files.writeString(Path.of(args[1]),new GsonBuilder().setPrettyPrinting().create().toJson(Map.of("policy","strategic-v1","positions",evidence.size(),"assertions",assertions,"evidence",evidence)));
        System.out.println("Strategic native contracts passed: "+evidence.size()+" positions; "+assertions+" assertions");System.exit(0);
    }
}

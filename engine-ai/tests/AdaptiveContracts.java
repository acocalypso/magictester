/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.*;
import org.magictester.engine.AndroidForgeBridge;
import forge.StaticData;
import forge.deck.*;
import forge.deck.io.DeckSerializer;
import forge.game.*;
import forge.game.card.*;
import forge.game.phase.PhaseType;
import forge.game.player.*;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.player.GamePlayerUtil;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;

/** Strategic v2: public match memory, matchup sideboarding and memory-based play on printed cards. */
public final class AdaptiveContracts {
    static int assertions=0;
    static final List<Map<String,Object>> evidence=new ArrayList<>();
    static String fixtures;
    static void check(boolean value,String label) {assertions++;if(!value)throw new AssertionError(label);}
    record Table(Match match,Game game,Player actor,Player opponent,int seat) {}
    static Deck deck(String name) {
        Deck deck=DeckSerializer.fromFile(new File(fixtures,name+".dck"));if(deck==null)throw new AssertionError("League deck exists: "+name);return deck;
    }
    static Table table(String policy,int seat,String mine,String theirs) {
        var roster=new ArrayList<RegisteredPlayer>();
        for(int i=0;i<2;i++) {var p=new RegisteredPlayer(deck(i==seat?mine:theirs));p.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(p);}
        Match match=new Match(new GameRules(GameType.Constructed),roster,"adaptive-contract");
        return next(match,policy,seat);
    }
    static Table next(Match match,String policy,int seat) {
        Game game=match.createGame();game.setAge(GameStage.Play);
        Player actor=game.getRegisteredPlayers().get(seat),opponent=game.getRegisteredPlayers().get(1-seat);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1,actor);
        String[] policies={"stable","stable"};policies[seat]=policy;AiPolicies.open(game,policies);
        return new Table(match,game,actor,opponent,seat);
    }
    static Card card(Player p,String name,ZoneType zone) {
        var paper=StaticData.instance().getCommonCards().getCard(name);if(paper==null)throw new AssertionError("Printed card exists: "+name);
        var c=Card.fromPaperCard(paper,p);p.getZone(zone).add(c);c.setSickness(false);return c;
    }
    static void show(Player p,ZoneType zone,String... names) {for(String name:names)card(p,name,zone);}
    /** Ends the current game after the opponent publicly showed these cards, then starts the next one. */
    static Table afterGame(Table t,String policy,String... shown) {
        show(t.opponent,ZoneType.Graveyard,shown);MatchMemory.refresh(t.game);
        evidence.add(Map.of("id","game-"+evidence.size(),"ai",AiPolicies.close(t.game)));
        return next(t.match,policy,t.seat);
    }
    static void finish(Table t,String label) {evidence.add(Map.of("id",label,"ai",AiPolicies.close(t.game)));}
    static Map<String,Integer> count(List<PaperCard> cards) {Map<String,Integer> m=new TreeMap<>();for(PaperCard c:cards)m.merge(c.getName(),1,Integer::sum);return m;}
    static List<PaperCard> plan(Table t) {return StrategicSideboard.plan(t.actor,t.match.getPlayers().get(t.seat).getDeck());}
    static void legal(Table t,List<PaperCard> plan,String label) {
        Deck deck=t.match.getPlayers().get(t.seat).getDeck();
        var before=count(deck.getMain().toFlatList());var pool=new TreeMap<>(before);
        for(var e:count(deck.get(DeckSection.Sideboard).toFlatList()).entrySet())pool.merge(e.getKey(),e.getValue(),Integer::sum);
        var after=count(plan);
        check(plan.size()==60,label+": main deck keeps 60 cards");
        for(var e:after.entrySet())check(e.getValue()<=pool.getOrDefault(e.getKey(),0),label+": no card is invented: "+e.getKey());
        for(var e:before.entrySet()) {
            PaperCard paper=StaticData.instance().getCommonCards().getCard(e.getKey());
            if(paper.getRules().getType().isLand())check(e.getValue().equals(after.get(e.getKey())),label+": lands are untouched: "+e.getKey());
        }
    }

    static void memory(int seat) {
        var t=table("strategic-v2",seat,"burn","affinity");
        show(t.opponent,ZoneType.Hand,"Black Lotus","Counterspell");show(t.opponent,ZoneType.Library,"Wrath of God");show(t.opponent,ZoneType.Sideboard,"Rest in Peace");
        show(t.opponent,ZoneType.Battlefield,"Frogmite","Frogmite","Seat of the Synod");show(t.opponent,ZoneType.Graveyard,"Galvanic Blast");
        var hidden=card(t.opponent,"Myr Enforcer",ZoneType.Exile);hidden.turnFaceDownNoUpdate();
        MatchMemory.refresh(t.game);
        var known=MatchMemory.known(t.opponent);
        check(known.getOrDefault("Frogmite",0)==2 && known.containsKey("Seat of the Synod") && known.containsKey("Galvanic Blast"),"Battlefield and graveyard cards are remembered with their copy counts");
        check(!known.containsKey("Black Lotus") && !known.containsKey("Counterspell"),"The opposing hand is never read");
        check(!known.containsKey("Wrath of God") && !known.containsKey("Rest in Peace"),"The opposing library and sideboard are never read");
        check(!known.containsKey("Myr Enforcer"),"Face-down cards stay unknown");
        check(MatchMemory.seenThisGame(t.opponent,"Frogmite")==2 && MatchMemory.gamesObserved(t.game)==0,"Current-game sightings are separate from finished games");
        var second=afterGame(t,"strategic-v2");
        check(MatchMemory.known(second.opponent).getOrDefault("Frogmite",0)==2,"Knowledge carries into the next game of the same match");
        check(MatchMemory.seenThisGame(second.opponent,"Frogmite")==0 && MatchMemory.gamesObserved(second.game)==1,"A new game starts with nothing seen this game");
        finish(second,"memory-next-game-"+seat);
        var other=table("strategic-v2",seat,"burn","affinity");
        check(MatchMemory.known(other.opponent).isEmpty(),"Nothing is shared between different matches");finish(other,"memory-isolation-"+seat);
    }
    static void roles(Player any) {
        check(CardRoles.of("Wrath of God",any).sweeper() && CardRoles.of("Wrath of God",any).sweepDamage()<0,"Destroy-all is an unconditional sweeper");
        check(CardRoles.of("Shrivel",any).sweeper() && CardRoles.of("Shrivel",any).sweepDamage()==1,"Minus one toughness to all is a one-damage sweeper");
        check(CardRoles.of("Electrickery",any).sweeper() && CardRoles.of("Electrickery",any).sweepDamage()==1,"Overload damage is a sweeper");
        check(CardRoles.of("Crypt Rats",any).sweeper(),"An activated damage-all ability is a sweeper");
        check(!CardRoles.of("Lightning Bolt",any).sweeper() && !CardRoles.of("Grizzly Bears",any).sweeper(),"Ordinary cards are not sweepers");
        check(CardRoles.of("Counterspell",any).counterspell() && !CardRoles.of("Lightning Bolt",any).counterspell(),"Counterspells are recognized from their script");
        check(CardRoles.of("Gurmag Angler",any).graveyard() && CardRoles.of("Think Twice",any).graveyard() && !CardRoles.of("Frogmite",any).graveyard(),"Delve and flashback mark graveyard use");
    }
    static void sideboarding(int seat) {
        for(String policy:List.of("stable","tactical-v1","tactical-v2","strategic-v1")) {
            var t=afterGame(table(policy,seat,"burn","affinity"),policy,"Frogmite","Frogmite","Myr Enforcer","Atog","Springleaf Drum","Chromatic Star","Ichor Wellspring");
            check(plan(t)==null,"Earlier policies keep native sideboarding: "+policy);finish(t,"native-sideboard-"+policy+"-"+seat);
        }
        var t=afterGame(table("strategic-v2",seat,"burn","affinity"),"strategic-v2","Frogmite","Frogmite","Myr Enforcer","Myr Enforcer","Atog","Springleaf Drum","Springleaf Drum","Chromatic Star","Ichor Wellspring","Flayer Husk","Great Furnace","Darksteel Citadel");
        var plan=plan(t);var after=count(plan);legal(t,plan,"burn vs artifacts");
        check(after.getOrDefault("Smash to Smithereens",0)==4,"Artifact removal comes in against a deck that showed artifacts");
        check(!after.containsKey("Relic of Progenitus"),"Graveyard hate stays out against a deck that never used its graveyard");
        check(!after.containsKey("Pyroblast"),"A blue hoser stays out when no blue card was shown");
        show(t.opponent,ZoneType.Hand,"Gurmag Angler","Stinkweed Imp","Counterspell","Delver of Secrets");show(t.opponent,ZoneType.Library,"Think Twice","Think Twice");
        check(count(plan(t)).equals(after),"Hidden cards in the opposing hand and library do not change the plan");
        finish(t,"sideboard-artifacts-"+seat);

        t=afterGame(table("strategic-v2",seat,"burn","graveyard"),"strategic-v2","Stinkweed Imp","Gurmag Angler","Moan of the Unhallowed","Moan of the Unhallowed","Chainer's Edict","Spider Spawning","Satyr Wayfinder","Grisly Salvage");
        plan=plan(t);after=count(plan);legal(t,plan,"burn vs graveyard");
        check(after.getOrDefault("Relic of Progenitus",0)==4,"Graveyard hate comes in against a graveyard deck");
        check(!after.containsKey("Smash to Smithereens"),"Artifact removal stays out when no artifact was shown");finish(t,"sideboard-graveyard-"+seat);

        t=afterGame(table("strategic-v2",seat,"black-control","blue-white-control"),"strategic-v2","Counterspell","Counterspell","Think Twice","Think Twice","Fact or Fiction","Wrath of God","Mana Leak","Path to Exile","Sphinx's Revelation");
        plan=plan(t);after=count(plan);legal(t,plan,"control mirror");
        check(after.getOrDefault("Duress",0)==4,"Discard comes in against a spell-based control deck");
        check(after.getOrDefault("Disfigure",0)==0 && after.getOrDefault("Dead Weight",0)==0,"Creature removal with nothing to hit goes out first");
        check(!after.containsKey("Shrivel"),"A sweeper stays out against a deck that showed no creatures");finish(t,"sideboard-creatureless-"+seat);

        t=afterGame(table("strategic-v2",seat,"faeries","burn"),"strategic-v2","Lightning Bolt","Lightning Bolt","Chain Lightning","Lava Spike","Rift Bolt","Thermo-Alchemist","Ghitu Lavarunner","Fireblast");
        plan=plan(t);after=count(plan);legal(t,plan,"faeries vs red");
        check(after.getOrDefault("Hydroblast",0)==4,"A red hoser comes in against a red deck");
        check(!after.containsKey("Annul") && !after.containsKey("Relic of Progenitus"),"Artifact and graveyard answers stay out against burn");finish(t,"sideboard-color-hoser-"+seat);

        t=afterGame(table("strategic-v2",seat,"burn","affinity"),"strategic-v2","Frogmite","Great Furnace","Seat of the Synod");
        plan=plan(t);
        check(count(plan).equals(count(t.match.getPlayers().get(seat).getDeck().getMain().toFlatList())),"Too little evidence changes nothing instead of guessing");finish(t,"sideboard-little-evidence-"+seat);

        t=afterGame(table("strategic-v2",seat,"burn","affinity"),"strategic-v2","Frogmite","Frogmite","Myr Enforcer","Atog","Springleaf Drum","Chromatic Star","Ichor Wellspring","Flayer Husk");
        var first=plan(t);
        Deck deck=t.match.getPlayers().get(seat).getDeck();var all=new CardPool();all.addAll(deck.getMain());all.addAll(deck.get(DeckSection.Sideboard));
        for(PaperCard c:first)all.remove(c);deck.getMain().clear();deck.getMain().add(first);deck.get(DeckSection.Sideboard).clear();deck.get(DeckSection.Sideboard).addAll(all);
        t=afterGame(t,"strategic-v2","Frogmite","Atog","Myr Enforcer");
        check(count(plan(t)).equals(count(first)),"A plan is stable in game three when nothing new was learned");finish(t,"sideboard-game-three-"+seat);
    }
    static void board(Table t,int opposingLands,String land) {
        for(int i=0;i<opposingLands;i++)card(t.opponent,land,ZoneType.Battlefield);
        card(t.actor,"Hill Giant",ZoneType.Battlefield);card(t.actor,"Hill Giant",ZoneType.Battlefield);card(t.actor,"Grizzly Bears",ZoneType.Battlefield);
        t.game.getAction().checkStaticAbilities();
    }
    static void restraint(int seat) {
        for(String policy:List.of("stable","strategic-v1","strategic-v2")) {
            var t=afterGame(table(policy,seat,"stompy","blue-white-control"),policy,"Wrath of God","Counterspell","Think Twice");
            board(t,4,"Plains");var bears=card(t.actor,"Grizzly Bears",ZoneType.Hand);
            check(StrategicPlay.holdCreature(t.actor,bears.getSpellPermanent())==policy.equals("strategic-v2"),"Only Strategic v2 keeps a creature back from a known board wipe: "+policy);
            if(policy.equals("strategic-v2")) {
                var haste=card(t.actor,"Raging Goblin",ZoneType.Hand);
                check(!StrategicPlay.holdCreature(t.actor,haste.getSpellPermanent()),"A haste creature adds damage now and is still cast");
                show(t.opponent,ZoneType.Hand,"Wrath of God","Wrath of God");
                check(StrategicPlay.holdCreature(t.actor,bears.getSpellPermanent()),"The decision does not depend on the opposing hand");
                t.opponent.setLife(40,null);
                check(!StrategicPlay.holdCreature(t.actor,bears.getSpellPermanent()),"Without a fast clock the board keeps developing");
            }
            finish(t,"restraint-"+policy+"-"+seat);
        }
        var t=afterGame(table("strategic-v2",seat,"stompy","blue-white-control"),"strategic-v2","Counterspell","Think Twice","Path to Exile");
        board(t,4,"Plains");var bears=card(t.actor,"Grizzly Bears",ZoneType.Hand);
        check(!StrategicPlay.holdCreature(t.actor,bears.getSpellPermanent()),"No restraint against a deck that never showed a sweeper");finish(t,"restraint-unknown-"+seat);

        t=afterGame(table("strategic-v2",seat,"stompy","blue-white-control"),"strategic-v2","Wrath of God");
        board(t,1,"Plains");bears=card(t.actor,"Grizzly Bears",ZoneType.Hand);
        check(!StrategicPlay.holdCreature(t.actor,bears.getSpellPermanent()),"A sweeper the opponent cannot cast soon is not feared");finish(t,"restraint-too-early-"+seat);

        t=afterGame(table("strategic-v2",seat,"stompy","burn"),"strategic-v2","Electrickery","Lightning Bolt");
        board(t,3,"Mountain");bears=card(t.actor,"Grizzly Bears",ZoneType.Hand);
        check(!StrategicPlay.holdCreature(t.actor,bears.getSpellPermanent()),"A one-damage sweeper does not threaten larger creatures");finish(t,"restraint-small-sweeper-"+seat);
    }
    public static void main(String[] args)throws Exception {
        AndroidForgeBridge.initialize(args[0],s->{});fixtures=args[1];
        for(int seat=0;seat<2;seat++) {memory(seat);sideboarding(seat);restraint(seat);}
        var t=table("strategic-v2",0,"burn","affinity");roles(t.actor);finish(t,"card-roles");
        if(args.length>2)Files.writeString(Path.of(args[2]),new GsonBuilder().setPrettyPrinting().create().toJson(Map.of("policy","strategic-v2","positions",evidence.size(),"assertions",assertions,"evidence",evidence)));
        System.out.println("Strategic v2 native contracts passed: "+evidence.size()+" positions; "+assertions+" assertions");System.exit(0);
    }
}

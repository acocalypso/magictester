/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.game.Game;
import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import java.util.*;

/** Adapter deliberately exposes features, not an omniscient or replayable game snapshot. */
public final class ForgeDecisionTrace {
    private ForgeDecisionTrace() {}
    private static final Map<Game,DecisionJournal> ACTIVE=Collections.synchronizedMap(new WeakHashMap<>());
    public static void open(Game game,boolean enabled,int seed) {if(enabled) ACTIVE.put(game,new DecisionJournal(seed));}
    public static Map<String,Object> close(Game game,boolean ended) {
        DecisionJournal journal=ACTIVE.remove(game);return journal==null?null:journal.finish(ended);
    }
    private static int seat(Player player) {
        var players=player.getGame().getMatch().getPlayers();
        for(int i=0;i<players.size();i++) if(players.get(i).getPlayer().equals(player.getLobbyPlayer())) return i;
        return -1;
    }
    private static Map<String,Object> entity(GameEntity entity,Player viewer) {
        Map<String,Object> out=new LinkedHashMap<>();
        if(entity instanceof Card) {
            Card card=(Card)entity;out.put("id","card:"+card.getId());out.put("type","card");
            boolean visible=card.getView().canBeShownTo(viewer.getView());
            out.put("name",visible?card.getName():null);out.put("identityVisible",visible);
            out.put("zone",card.getZone()==null?null:card.getZone().getZoneType().name());
        } else if(entity instanceof Player) {
            out.put("id","player:"+seat((Player)entity));out.put("type","player");
        } else {out.put("id","entity:"+entity.getId());out.put("type","other");}
        return out;
    }
    public static DecisionJournal.Choice begin(Player actor,Iterable<? extends GameEntity> candidates,SpellAbility ability,boolean optional) {
        DecisionJournal journal=ACTIVE.get(actor.getGame());if(journal==null) return null;
        if(!journal.canCapture()) {journal.dropped();return null;}
        try {
            List<Map<String,Object>> options=new ArrayList<>();
            for(GameEntity e:candidates) {if(options.size()>=DecisionJournal.MAX_OPTIONS) {journal.dropped();return null;}options.add(entity(e,actor));}
            Map<String,Object> state=new LinkedHashMap<>();state.put("actor",seat(actor));
            var phase=actor.getGame().getPhaseHandler();state.put("turn",phase.getTurn());
            state.put("phase",phase.getPhase()==null?null:phase.getPhase().name());
            state.put("abilityApi",ability==null||ability.getApi()==null?null:ability.getApi().name());
            state.put("source",ability==null?null:entity(ability.getHostCard(),actor));
            List<Map<String,Object>> players=new ArrayList<>();
            for(Player player:actor.getGame().getRegisteredPlayers()) {
                Map<String,Object> p=new LinkedHashMap<>();p.put("seat",seat(player));p.put("life",player.getLife());
                p.put("handSize",player.getCardsIn(ZoneType.Hand).size());p.put("librarySize",player.getCardsIn(ZoneType.Library).size());
                // Never put the opponent's hand identities or either library's order into observations.
                if(player==actor) {List<Map<String,Object>> hand=new ArrayList<>();for(Card c:player.getCardsIn(ZoneType.Hand)) hand.add(entity(c,actor));p.put("ownHand",hand);}
                List<Map<String,Object>> board=new ArrayList<>();int total=0;
                for(Card c:player.getCardsIn(ZoneType.Battlefield)) {if(total++<80) board.add(entity(c,actor));}
                p.put("battlefield",board);p.put("battlefieldTruncated",total>80);players.add(p);
            }
            state.put("players",players);return journal.begin(state,options,optional);
        } catch(RuntimeException error) {journal.dropped();return null;}
    }
    public static void complete(DecisionJournal.Choice choice,GameEntity selected,Player actor) {
        if(choice!=null) try {choice.complete(selected==null?null:(String)entity(selected,actor).get("id"));} catch(RuntimeException error) {choice.failed();}
    }
}

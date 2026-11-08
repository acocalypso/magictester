/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.game.Game;
import forge.game.player.Player;
import java.util.*;

/** Per-game/per-seat policy selection. Values never retain the game or its players. */
public final class AiPolicies {
    public static final String STABLE="stable", TACTICAL="tactical-v1";
    private static final Map<Game,Context> ACTIVE=Collections.synchronizedMap(new WeakHashMap<>());
    private static final class Context {
        final List<String> seats;
        final long[] evaluations;
        Context(List<String> seats) {this.seats=seats;this.evaluations=new long[seats.size()];}
    }
    private AiPolicies() {}
    public static List<String> validate(String[] requested,int players) {
        if(requested!=null && requested.length!=players) throw new IllegalArgumentException("aiPolicies must contain one policy per seat");
        List<String> result=new ArrayList<>();
        for(int i=0;i<players;i++) {
            String policy=requested==null?STABLE:requested[i];
            if(!STABLE.equals(policy) && !TACTICAL.equals(policy)) throw new IllegalArgumentException("Unknown AI policy: "+policy);
            result.add(policy);
        }
        return List.copyOf(result);
    }
    public static void open(Game game,String[] requested) {
        ACTIVE.put(game,new Context(validate(requested,game.getMatch().getPlayers().size())));
    }
    private static int seat(Player actor) {
        var roster=actor.getGame().getMatch().getPlayers();
        for(int i=0;i<roster.size();i++) if(roster.get(i).getPlayer().equals(actor.getLobbyPlayer())) return i;
        return -1;
    }
    public static boolean tactical(Player actor) {
        Context context=ACTIVE.get(actor.getGame());if(context==null) return false;int seat=seat(actor);
        return seat>=0 && TACTICAL.equals(context.seats.get(seat));
    }
    static void suggested(Player actor) {
        Context context=ACTIVE.get(actor.getGame());int seat=seat(actor);
        if(context!=null && seat>=0) synchronized(context) {context.evaluations[seat]++;}
    }
    public static Map<String,Object> close(Game game) {
        Context context=ACTIVE.remove(game);
        if(context==null) throw new IllegalStateException("AI policy context was not opened");
        List<Map<String,Object>> seats=new ArrayList<>();
        synchronized(context) {
            for(int i=0;i<context.seats.size();i++) {
                boolean tactical=TACTICAL.equals(context.seats.get(i));
                seats.add(Map.of("seat",i,"id",context.seats.get(i),"profile","Default",
                    "policyRevision",tactical?"damage-lethal-2":"forge-native",
                    "experimental",tactical,"lethalPriorityEvaluations",context.evaluations[i]));
            }
        }
        return Map.of("schemaVersion",1,"seats",seats,"evaluationCountsAreAppliedActions",false);
    }
}

/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.game.Game;
import forge.game.player.Player;
import java.util.*;

/** Per-game/per-seat policy selection. Values never retain the game or its players. */
public final class AiPolicies {
    public static final String STABLE="stable", TACTICAL="tactical-v1", EXPANDED="tactical-v2", STRATEGIC="strategic-v1", ADAPTIVE="strategic-v2";
    private static final Map<Game,Context> ACTIVE=Collections.synchronizedMap(new WeakHashMap<>());
    private static final class Context {
        final List<String> seats;
        final long[] evaluations,timeouts;
        final List<Map<String,Long>> suggestions=new ArrayList<>();
        Context(List<String> seats) {this.seats=seats;this.evaluations=new long[seats.size()];this.timeouts=new long[seats.size()];for(String ignored:seats) suggestions.add(new TreeMap<>());}
    }
    private AiPolicies() {}
    public static List<String> validate(String[] requested,int players) {
        if(requested!=null && requested.length!=players) throw new IllegalArgumentException("aiPolicies must contain one policy per seat");
        List<String> result=new ArrayList<>();
        for(int i=0;i<players;i++) {
            String policy=requested==null?STABLE:requested[i];
            if(!STABLE.equals(policy) && !TACTICAL.equals(policy) && !EXPANDED.equals(policy) && !STRATEGIC.equals(policy) && !ADAPTIVE.equals(policy)) throw new IllegalArgumentException("Unknown AI policy: "+policy);
            result.add(policy);
        }
        return List.copyOf(result);
    }
    public static void open(Game game,String[] requested) {
        ACTIVE.put(game,new Context(validate(requested,game.getMatch().getPlayers().size())));
        MatchMemory.open(game);
    }
    static int seat(Player actor) {
        var roster=actor.getGame().getMatch().getPlayers();
        for(int i=0;i<roster.size();i++) if(roster.get(i).getPlayer().equals(actor.getLobbyPlayer())) return i;
        return -1;
    }
    public static boolean tactical(Player actor) {
        Context context=ACTIVE.get(actor.getGame());if(context==null) return false;int seat=seat(actor);
        return seat>=0 && !STABLE.equals(context.seats.get(seat));
    }
    public static boolean expanded(Player actor) {
        Context context=ACTIVE.get(actor.getGame());if(context==null)return false;int seat=seat(actor);
        return seat>=0 && (EXPANDED.equals(context.seats.get(seat)) || STRATEGIC.equals(context.seats.get(seat)) || ADAPTIVE.equals(context.seats.get(seat)));
    }
    public static boolean strategic(Player actor) {
        Context context=ACTIVE.get(actor.getGame());if(context==null)return false;int seat=seat(actor);
        return seat>=0 && (STRATEGIC.equals(context.seats.get(seat)) || ADAPTIVE.equals(context.seats.get(seat)));
    }
    /** Strategic v2: everything in Strategic v1 plus match memory, matchup sideboarding and memory-based play. */
    public static boolean adaptive(Player actor) {
        Context context=ACTIVE.get(actor.getGame());if(context==null)return false;int seat=seat(actor);
        return seat>=0 && ADAPTIVE.equals(context.seats.get(seat));
    }
    static void note(Player actor,String feature) {
        Context context=ACTIVE.get(actor.getGame());int seat=seat(actor);
        if(context!=null && seat>=0) synchronized(context) {context.suggestions.get(seat).merge(feature,1L,Long::sum);}
    }
    public static void evaluationTimedOut(Player actor) {
        Context context=ACTIVE.get(actor.getGame());int seat=seat(actor);
        if(context!=null && seat>=0) synchronized(context) {context.timeouts[seat]++;}
    }
    static void suggested(Player actor) {
        Context context=ACTIVE.get(actor.getGame());int seat=seat(actor);
        if(context!=null && seat>=0) synchronized(context) {context.evaluations[seat]++;context.suggestions.get(seat).merge("burn-lethal",1L,Long::sum);}
    }
    public static Map<String,Object> close(Game game) {
        Context context=ACTIVE.remove(game);
        if(context==null) throw new IllegalStateException("AI policy context was not opened");
        Map<String,Object> memory=MatchMemory.close(game);
        List<Map<String,Object>> seats=new ArrayList<>();
        synchronized(context) {
            for(int i=0;i<context.seats.size();i++) {
                boolean adaptive=ADAPTIVE.equals(context.seats.get(i));
                boolean strategic=STRATEGIC.equals(context.seats.get(i)) || adaptive;
                boolean expanded=EXPANDED.equals(context.seats.get(i)) || strategic;
                boolean tactical=!STABLE.equals(context.seats.get(i));
                seats.add(Map.of("seat",i,"id",context.seats.get(i),"profile","Default",
                    "policyRevision",adaptive?"strategy-2":strategic?"strategy-1":expanded?"expanded-2":tactical?"damage-lethal-2":"forge-native",
                    "experimental",tactical,"lethalPriorityEvaluations",context.evaluations[i],
                    "features",adaptive?List.of("expanded-v2","mana-aware-mulligans","london-bottom-search","conditional-haste-timing","mana-refund-sequencing","team-haste-sequencing","bounded-combat-search","public-match-memory","matchup-sideboarding","known-sweeper-restraint"):strategic?List.of("expanded-v2","mana-aware-mulligans","london-bottom-search","conditional-haste-timing","mana-refund-sequencing","team-haste-sequencing","bounded-combat-search"):expanded?List.of("burn-lethal","x-paid-and-metalcraft","life-loss-lethal","mill-public-protection","draw-library-boundary","discard-card-count","poison-immune-targets"):tactical?List.of("burn-lethal"):List.of(),
                    "evaluationSuggestions",Map.copyOf(context.suggestions.get(i)),"evaluationTimeouts",context.timeouts[i]));
            }
        }
        return Map.of("schemaVersion",1,"seats",seats,"evaluationCountsAreAppliedActions",false,"matchMemory",memory,
            "executionSafeguards",List.of("interrupt-checkpoints","no-forced-thread-stop","abort-stalled-evaluation"));
    }
}

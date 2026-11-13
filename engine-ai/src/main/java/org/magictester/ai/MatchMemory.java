/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.event.*;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import java.util.*;

/**
 * What every player at the table has publicly shown during one match.
 *
 * Only public information is recorded: spells and abilities announced on the stack, lands played,
 * and face-up cards in the battlefield, graveyard, exile, stack and command zones. Hands, libraries,
 * face-down cards and sideboards are never read, so a policy that consults this memory knows exactly
 * what an attentive opponent would know. Knowledge is kept per match, so game two and three of a
 * best-of-three can use what game one revealed. Nothing is shared between matches.
 */
public final class MatchMemory {
    private static final Map<Match,MatchMemory> MATCHES=Collections.synchronizedMap(new WeakHashMap<>());
    private static final Map<Game,Live> LIVE=Collections.synchronizedMap(new WeakHashMap<>());
    private static final List<ZoneType> PUBLIC=List.of(ZoneType.Battlefield,ZoneType.Graveyard,ZoneType.Exile,ZoneType.Stack,ZoneType.Command);

    /** Per owner seat: card name to the most copies seen in any single finished game. */
    private final List<Map<String,Integer>> finished=new ArrayList<>();
    private int games;
    private MatchMemory(int seats) {for(int i=0;i<seats;i++)finished.add(new HashMap<>());}

    /** Observes one running game. Public so tests can feed it; subscribed to Forge's event bus. */
    public static final class Live {
        private final java.lang.ref.WeakReference<Game> game; // never keep a finished game alive
        private final List<Map<String,Set<Integer>>> seen=new ArrayList<>();
        private Live(Game game,int seats) {this.game=new java.lang.ref.WeakReference<>(game);for(int i=0;i<seats;i++)seen.add(new HashMap<>());}
        @Subscribe public void event(GameEvent event) {
            try {
                Game game=this.game.get();if(game==null)return;
                if(event instanceof GameEventSpellAbilityCast cast) observe(game.findByView(cast.sa().getHostCard()));
                else if(event instanceof GameEventLandPlayed land) observe(game.findByView(land.land()));
                else if(event instanceof GameEventTurnBegan) scan();
            } catch(RuntimeException ignored) {
                // Memory is advisory. A missed observation must never disturb the game.
            }
        }
        synchronized void observe(Card card) {
            if(card==null || card.isToken() || card.isFaceDown() || card.isCopiedSpell() || card.getPaperCard()==null)return;
            Player owner=card.getOwner();if(owner==null)return;
            int seat=AiPolicies.seat(owner);if(seat<0 || seat>=seen.size())return;
            seen.get(seat).computeIfAbsent(card.getPaperCard().getName(),k->new HashSet<>()).add(card.getId());
        }
        void scan() {Game game=this.game.get();if(game!=null)for(Card card:game.getCardsIn(PUBLIC))observe(card);}
        synchronized Map<String,Integer> counts(int seat) {
            Map<String,Integer> result=new HashMap<>();
            for(var entry:seen.get(seat).entrySet())result.put(entry.getKey(),entry.getValue().size());
            return result;
        }
    }

    static void open(Game game) {
        int seats=game.getMatch().getPlayers().size();
        MATCHES.computeIfAbsent(game.getMatch(),m->new MatchMemory(seats));
        Live live=new Live(game,seats);LIVE.put(game,live);game.subscribeToEvents(live);
    }

    /** Re-reads the public zones now, for callers that cannot wait for the next turn. */
    public static void refresh(Game game) {
        Live live=LIVE.get(game);
        if(live!=null) try {live.scan();} catch(RuntimeException ignored) {/* Advisory only. */}
    }

    /** Folds the finished game into the match record and reports counts only, never card names. */
    static Map<String,Object> close(Game game) {
        Live live=LIVE.remove(game);MatchMemory memory=MATCHES.get(game.getMatch());
        if(live==null || memory==null)return Map.of("gamesObserved",0,"cardsKnownBySeat",List.of());
        try {live.scan();} catch(RuntimeException ignored) {/* A timed-out game may still be mutating zones. */}
        List<Integer> known=new ArrayList<>();
        synchronized(memory) {
            memory.games++;
            for(int seat=0;seat<memory.finished.size();seat++) {
                for(var entry:live.counts(seat).entrySet())memory.finished.get(seat).merge(entry.getKey(),entry.getValue(),Math::max);
                known.add(memory.finished.get(seat).size());
            }
            return Map.of("gamesObserved",memory.games,"cardsKnownBySeat",known,"scope","public-zones-and-announced-spells");
        }
    }

    /** Cards this player has publicly shown in the match so far: name to copies seen. */
    public static Map<String,Integer> known(Player subject) {
        Game game=subject.getGame();int seat=AiPolicies.seat(subject);
        Map<String,Integer> result=new TreeMap<>();if(seat<0)return result;
        MatchMemory memory=MATCHES.get(game.getMatch());
        if(memory!=null) synchronized(memory) {if(seat<memory.finished.size())result.putAll(memory.finished.get(seat));}
        Live live=LIVE.get(game);
        if(live!=null && seat<live.seen.size()) for(var entry:live.counts(seat).entrySet())result.merge(entry.getKey(),entry.getValue(),Math::max);
        return result;
    }

    /** Copies of one card this player has shown during the current game only. */
    public static int seenThisGame(Player subject,String name) {
        Live live=LIVE.get(subject.getGame());int seat=AiPolicies.seat(subject);
        if(live==null || seat<0 || seat>=live.seen.size())return 0;
        return live.counts(seat).getOrDefault(name,0);
    }

    /** Finished games already folded into this match's record. */
    public static int gamesObserved(Game game) {
        MatchMemory memory=MATCHES.get(game.getMatch());if(memory==null)return 0;
        synchronized(memory) {return memory.games;}
    }
}

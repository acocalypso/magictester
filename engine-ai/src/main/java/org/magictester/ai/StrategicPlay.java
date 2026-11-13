/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.game.card.Card;
import forge.game.keyword.Keyword;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import java.util.Map;

/** In-game decisions that use what the opponent has already shown during the match. */
public final class StrategicPlay {
    private StrategicPlay() {}
    /** Turns of attacking the current board needs; a faster clock means more creatures add little. */
    static final int ENOUGH_PRESSURE_TURNS=3;

    /**
     * Do not pour more creatures into a board wipe the opponent is known to play.
     *
     * Applies only when the opponent has shown a sweeper this match that they can cast by their next
     * turn and may still hold, the current board already wins quickly and would be destroyed by it,
     * and the creature being considered adds nothing immediate. At most two creatures are kept back,
     * so the hand is never flooded. Reads public zones and the acting player's own hand only.
     */
    public static boolean holdCreature(Player actor,SpellAbility spell) {
        if(!AiPolicies.adaptive(actor) || spell==null || !spell.isSpell() || actor.getGame().getPlayers().size()!=2)return false;
        Card creature=spell.getHostCard();
        if(creature==null || !creature.isCreature() || !actor.getGame().getPhaseHandler().isPlayerTurn(actor) || !actor.getGame().getStack().isEmpty())return false;
        if(creature.hasKeyword(Keyword.HASTE) || creature.hasKeyword(Keyword.FLASH) || creature.hasETBTrigger(false))return false;
        Player opponent=actor.getOpponents().get(0);
        var board=actor.getCreaturesInPlay();
        if(board.size()<2 || board.size()<=opponent.getCreaturesInPlay().size())return false;
        int power=0;for(Card c:board)power+=Math.max(0,c.getNetPower());
        if(power<=0 || (opponent.getLife()+power-1)/power>ENOUGH_PRESSURE_TURNS)return false;
        int held=0;for(Card c:actor.getCardsIn(ZoneType.Hand))if(c!=creature && c.isCreature())held++;
        if(held>=2 || actor.getCardsIn(ZoneType.Hand).size()>=actor.getMaxHandSize())return false;

        int lands=opponent.getLandsInPlay().size();
        for(Map.Entry<String,Integer> entry:MatchMemory.known(opponent).entrySet()) {
            CardRoles.Role role=CardRoles.of(entry.getKey(),opponent);
            if(!role.sweeper() || role.cmc()>lands+1)continue;
            // Every copy they have ever shown is already used up this game: nothing left to fear.
            int spent=0;for(Card c:opponent.getCardsIn(ZoneType.Graveyard))if(c.getName().equals(entry.getKey()))spent++;
            for(Card c:opponent.getCardsIn(ZoneType.Exile))if(!c.isFaceDown() && c.getName().equals(entry.getKey()))spent++;
            if(spent>=4)continue;
            int lost=0;for(Card c:board)if(role.sweeps(c))lost++;
            if(lost*2<board.size() || !role.sweeps(creature))continue;
            AiPolicies.note(actor,"hold-creature-vs-known-sweeper");return true;
        }
        return false;
    }
}

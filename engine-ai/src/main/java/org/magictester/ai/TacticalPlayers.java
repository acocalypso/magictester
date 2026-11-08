/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.game.ability.ApiType;
import forge.game.player.GameLossReason;
import forge.game.player.Player;
import forge.game.replacement.ReplacementType;
import forge.game.replacement.ReplacementLayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

/** Public-information player-target heuristics for the expanded experimental policy. */
public final class TacticalPlayers {
    private TacticalPlayers() {}
    private static boolean simple(Player actor,SpellAbility ability,ApiType api) {
        return AiPolicies.expanded(actor) && ability.getApi()==api && ability.usesTargeting()
            && ability.getMaxTargets()==1 && ability.getParent()==null && ability.getSubAbility()==null
            && !ability.hasParam("AILogic") && !ability.hasParam("TargetingPlayer")
            && !ability.hasParam("Defined");
    }
    private static int constant(SpellAbility ability,String key) {
        String value=ability.getParam(key);
        return value!=null && value.matches("[0-9]{1,6}")?Integer.parseInt(value):0;
    }
    private static boolean visibleLossReplacement(Player viewer,boolean life) {
        for(ZoneType zone:new ZoneType[]{ZoneType.Battlefield,ZoneType.Command}) {
            for(var card:viewer.getGame().getCardsIn(zone)) {
                if(!card.getView().canBeShownTo(viewer.getView())) continue;
                for(var r:card.getReplacementEffects()) {
                    if(!r.zonesCheck(card.getZone())) continue;
                    if((life && r.getMode()==ReplacementType.LifeReduced)
                            || (r.getMode()==ReplacementType.GameLoss && r.getLayer()!=ReplacementLayer.CantHappen)) return true;
                }
            }
        }
        return false;
    }
    public static Player lifeLoss(Player actor,SpellAbility ability) {
        if(!simple(actor,ability,ApiType.LoseLife) || visibleLossReplacement(actor,true)) return null;
        int amount=constant(ability,"LifeAmount");if(amount<=0) return null;
        Player best=null;
        for(Player p:actor.getOpponents()) {
            if(ability.canTarget(p) && p.canLoseLife() && !p.cantLoseForZeroOrLessLife()
                    && !p.cantLose() && p.getLife()<=amount && (best==null || p.getLife()<best.getLife())) best=p;
        }
        if(best!=null) AiPolicies.note(actor,"life-loss-lethal");
        return best;
    }
    public static Player discard(Player actor,SpellAbility ability) {
        if(!simple(actor,ability,ApiType.Discard) || ability.hasParam("DiscardValid")
                || ability.hasParam("Mode") || ability.hasParam("AnyNumber") || ability.hasParam("UnlessCost")) return null;
        int amount=constant(ability,"NumCards");if(amount<=0) return null;
        Player best=null;int value=0;
        for(Player p:actor.getOpponents()) {
            int discard=Math.min(amount,p.getCardsIn(ZoneType.Hand).size());
            if(discard>value && ability.canTarget(p) && p.canDiscardBy(ability,true)) {best=p;value=discard;}
        }
        if(best!=null) AiPolicies.note(actor,"discard-card-count");
        return best;
    }
    /** Recognize a visible draw replacement that directly wins, without looking inside a library. */
    public static boolean drawWin(Player viewer,Player target) {
        for(ZoneType zone:new ZoneType[]{ZoneType.Battlefield,ZoneType.Command}) {
            for(var card:target.getCardsIn(zone)) {
                if(!card.getView().canBeShownTo(viewer.getView())) continue;
                for(var r:card.getReplacementEffects()) {
                    if(r.getMode()==ReplacementType.Draw && r.zonesCheck(card.getZone()) && r.hasParam("ReplaceWith")) {
                        String script=card.getSVar(r.getParam("ReplaceWith"));
                        if(script.matches("(?s).*\\bDB\\$\\s*WinsGame\\b.*")) return true;
                    }
                }
            }
        }
        return false;
    }
    private static boolean recyclesMill(Player viewer,Player target) {
        for(var card:viewer.getGame().getCardsIn(ZoneType.Battlefield)) {
            if(!card.getView().canBeShownTo(viewer.getView())) continue;
            for(var r:card.getReplacementEffects()) {
                if(r.getMode()!=ReplacementType.Moved || !r.zonesCheck(card.getZone())
                        || !"Graveyard".equals(r.getParam("Destination")) || !r.hasParam("ReplaceWith")) continue;
                String script=card.getSVar(r.getParam("ReplaceWith"));
                if(script.contains("Destination$ Library") && script.contains("Defined$ ReplacedCard")
                        && (card.getEntityAttachedTo()==null || card.getEntityAttachedTo().equals(target))) return true;
            }
        }
        return false;
    }
    /** Null delegates to native logic; false declines an optional pointless/harmful mill. */
    public static Boolean mill(Player actor,SpellAbility ability,boolean mandatory) {
        if(!simple(actor,ability,ApiType.Mill) || visibleLossReplacement(actor,false)) return null;
        int amount=constant(ability,"NumCards");if(amount<=0) return null;
        Player best=null;int remaining=Integer.MAX_VALUE;
        for(Player p:actor.getOpponents()) {
            int library=p.getCardsIn(ZoneType.Library).size();
            if(library==0 || !ability.canTarget(p) || !p.canDraw() || p.cantLoseCheck(GameLossReason.Milled)
                    || drawWin(actor,p) || recyclesMill(actor,p)) continue;
            int after=Math.max(0,library-amount);
            if(after<remaining) {best=p;remaining=after;}
        }
        if(best==null) return mandatory?null:Boolean.FALSE;
        ability.resetTargets();ability.getTargets().add(best);AiPolicies.note(actor,"mill-public-protection");return true;
    }
    public static boolean drawWouldDeck(Player actor,SpellAbility ability,int cards,Player target) {
        int library=target.getCardsIn(ZoneType.Library).size();
        if(!simple(actor,ability,ApiType.Draw)) return cards>=library;
        boolean lethal=cards>library && !drawWin(actor,target) && !visibleLossReplacement(actor,false);
        if(cards>=library && !lethal) AiPolicies.note(actor,"draw-library-boundary");
        return lethal;
    }
    public static boolean declinePoison(Player actor) {AiPolicies.note(actor,"poison-immune-targets");return false;}
    public static boolean optionalPoison(Player actor,SpellAbility ability) {
        return simple(actor,ability,ApiType.Poison);
    }
}

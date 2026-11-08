/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.ai.ComputerUtilCombat;
import forge.game.ability.ApiType;
import forge.game.replacement.ReplacementType;
import forge.game.replacement.ReplacementLayer;
import forge.game.zone.ZoneType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

/** Narrow experimental correction to native single-target burn opponent ranking. */
public final class TacticalDamage {
    private TacticalDamage() {}
    public static Player preferLethal(Player actor,SpellAbility ability,int damage,Player baseline) {
        if(!AiPolicies.tactical(actor) || damage<=0 || ability.getApi()!=ApiType.DealDamage
                || !ability.usesTargeting() || ability.getMaxTargets()!=1
                || !ability.getTargetRestrictions().canTgtPlayer()
                || ability.getParent()!=null || ability.getSubAbility()!=null
                || ability.isDividedAsYouChoose()) return baseline;
        // Dynamic damage, chained effects and special card scripts need their own tactical fixtures.
        String amount=ability.getParam("NumDmg");
        boolean numeric=amount!=null && amount.matches("[0-9]{1,6}");
        boolean paidX=AiPolicies.expanded(actor) && "X".equals(amount) && "Count$xPaid".equals(ability.getSVar("X"))
            && ability.getRootAbility().getXManaCostPaid()!=null;
        boolean metalcraft=AiPolicies.expanded(actor) && "X".equals(amount) && ability.getSVar("X").matches("Count\\$Metalcraft\\.[0-9]{1,6}\\.[0-9]{1,6}");
        if(!numeric && !paidX && !metalcraft) return baseline;
        for(String parameter:new String[]{"AILogic","DamageSource","DivideEvenly","DividerOnResolution","Radiance"}) {
            if(ability.hasParam(parameter)) return baseline;
        }
        // Forge's damage predictor does not model LifeReduced or arbitrary GameLoss replacements.
        // Do not run a replacement effect while planning: it can prompt or mutate the game.
        for(ZoneType zone:new ZoneType[]{ZoneType.Battlefield,ZoneType.Command}) {
            for(var card:actor.getGame().getCardsIn(zone)) {
                if(!card.getView().canBeShownTo(actor.getView())) continue;
                for(var replacement:card.getReplacementEffects()) {
                    boolean unsupported=replacement.getMode()==ReplacementType.LifeReduced
                        || (replacement.getMode()==ReplacementType.GameLoss && replacement.getLayer()!=ReplacementLayer.CantHappen);
                    if(unsupported && replacement.zonesCheck(card.getZone())) return baseline;
                }
            }
        }
        var source=ability.getHostCard();
        Player preferred=null;
        for(Player opponent:actor.getOpponents()) {
            if(!ability.canTarget(opponent) || !opponent.canLoseLife()
                    || opponent.cantLoseForZeroOrLessLife() || opponent.cantLose()
                    || source.isInfectDamage(opponent)) continue;
            int predicted=ability.hasParam("NoPrevention")
                ? opponent.staticReplaceDamage(damage,source,false)
                : ComputerUtilCombat.predictDamageTo(opponent,damage,source,false);
            if(predicted>0 && predicted>=opponent.getLife()
                    && (preferred==null || opponent.getLife()<preferred.getLife())) preferred=opponent;
        }
        if(preferred==null) return baseline;
        if(preferred!=baseline) AiPolicies.suggested(actor);
        return preferred;
    }
}

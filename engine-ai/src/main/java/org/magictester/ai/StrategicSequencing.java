/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.game.ability.ApiType;
import forge.game.card.*;
import forge.game.keyword.Keyword;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import java.util.*;

/** Deterministic ordering hints; Forge still checks timing, costs, targets and willingness. */
public final class StrategicSequencing {
    private StrategicSequencing() {}
    private static boolean ownMain(Player actor) {
        return AiPolicies.strategic(actor) && actor.getGame().getPhaseHandler().is(PhaseType.MAIN1,actor) && actor.getGame().getStack().isEmpty();
    }
    private static boolean refund(Card c) {return c.isCreature() && "True".equalsIgnoreCase(c.getSVar("FreeSpellAI"));}
    public static boolean beforeCombat(Player actor,SpellAbility sa) {
        if(!ownMain(actor) || !sa.isSpell() || !sa.getHostCard().isCreature())return false;
        Card c=sa.getHostCard();
        if(refund(c)) {AiPolicies.note(actor,"mana-refund-main1");return true;}
        // Support self-only continuous haste conditional on a simple own-board presence check.
        // Do not invoke static effects from the hand or temporarily move a card into play.
        Set<String> parameters=Set.of("Mode","AffectedDefined","AddKeyword","IsPresent","PresentCompare","AddPower","AddToughness","Description");
        for(var effect:c.getStaticAbilities()) {
            if(!parameters.containsAll(effect.getMapParams().keySet()) || !"Continuous".equals(effect.getParam("Mode"))
                    || !"Self".equals(effect.getParam("AffectedDefined")) || !"Haste".equals(effect.getParam("AddKeyword")))continue;
            String present=effect.getParam("IsPresent");
            if(present==null || !present.matches("(Artifact|Creature|Enchantment|Land|Equipment)\\.YouCtrl")
                    || !"GE1".equals(effect.getParamOrDefault("PresentCompare","GE1")))continue;
            for(Card own:actor.getCardsIn(ZoneType.Battlefield)) if(own.isValid(present,actor,c,effect)) {
                AiPolicies.note(actor,"conditional-haste-main1");return true;
            }
        }
        if(sa.getPayCosts()!=null && !teamHaste(sa)) {
            int available=availableMana(actor);
            for(Card hand:actor.getCardsIn(ZoneType.Hand)) if(hand!=c) for(var finisher:hand.getSpellAbilities()) {
                if(!finisher.isSpell() || finisher.getPayCosts()==null || !teamHaste(finisher) || !grantsTo(finisher,c))continue;
                int finishCost=finisher.getPayCosts().getTotalMana().getCMC()+(hand.hasKeyword(Keyword.KICKER)?1:0);
                if(sa.getPayCosts().getTotalMana().getCMC()+finishCost<=available) {
                    AiPolicies.note(actor,"team-haste-setup-main1");return true;
                }
            }
        }
        return false;
    }
    private static boolean grantsTo(SpellAbility haste,Card setup) {
        for(SpellAbility ability=haste;ability!=null;ability=ability.getSubAbility())
            if(ability.getApi()==ApiType.PumpAll && "Haste".equals(ability.getParam("KW"))) {
                String valid=ability.getParam("ValidCards");
                if(valid!=null && valid.matches("[A-Za-z]+\\.YouCtrl") && setup.isValid(valid,setup.getController(),haste.getHostCard(),ability))return true;
            }
        for(var trigger:haste.getHostCard().getTriggers()) {
            String execute=trigger.getParam("Execute");if(execute==null)continue;
            String text=haste.getHostCard().getSVar(execute);
            if(!text.contains("DB$ PumpAll") || !text.contains("KW$ Haste"))continue;
            var match=java.util.regex.Pattern.compile("(?:^|\\|)\\s*ValidCards\\$\\s*([A-Za-z]+\\.YouCtrl)\\s*(?:\\||$)").matcher(text);
            if(match.find() && setup.isValid(match.group(1),setup.getController(),haste.getHostCard(),haste))return true;
        }
        return false;
    }
    private static int availableMana(Player actor) {
        int mana=actor.getManaPool().totalMana();
        for(Card c:actor.getCardsIn(ZoneType.Battlefield)) if(c.isLand() && !c.isTapped() && !c.getManaAbilities().isEmpty())mana++;
        return mana;
    }
    private static boolean teamHaste(SpellAbility sa) {
        for(SpellAbility ability=sa;ability!=null;ability=ability.getSubAbility())
            if(ability.getApi()==ApiType.PumpAll && "Haste".equals(ability.getParam("KW")))return true;
        for(var trigger:sa.getHostCard().getTriggers()) {
            String execute=trigger.getParam("Execute");
            if(execute!=null) {
                String text=sa.getHostCard().getSVar(execute);
                if(text.contains("DB$ PumpAll") && text.matches("(?s).*\\bKW\\$ Haste(?: \\|.*|$)"))return true;
            }
        }
        return false;
    }
    public static void order(Player actor,List<SpellAbility> choices) {
        if(!ownMain(actor) || choices.size()<2)return;
        int mana=availableMana(actor);
        // Move an affordable setup creature immediately ahead of a team-haste spell.
        // Leave burn, removal, counters and all unrelated native priorities in their original order.
        for(int i=0;i<choices.size();i++) {
            SpellAbility haste=choices.get(i);
            if(!haste.isSpell() || !teamHaste(haste) || haste.getPayCosts()==null)continue;
            int hasteCost=haste.getPayCosts().getTotalMana().getCMC()+(haste.getHostCard().hasKeyword(Keyword.KICKER)?1:0);
            for(int j=i+1;j<choices.size();j++) {
                SpellAbility setup=choices.get(j);Card c=setup.getHostCard();
                if(!setup.isSpell() || !c.isCreature() || teamHaste(setup) || setup.getPayCosts()==null || !grantsTo(haste,c))continue;
                int cost=refund(c)?0:setup.getPayCosts().getTotalMana().getCMC();
                if(cost>2 || cost+hasteCost>mana)continue;
                choices.remove(j);choices.add(i,setup);AiPolicies.note(actor,"team-haste-order");break;
            }
        }
    }
}

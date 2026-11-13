/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.StaticData;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerType;
import forge.item.PaperCard;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads what a card does from Forge's own card script instead of a list of card names, so every
 * printed card is classified the same way. Results that depend only on the printed rules are cached
 * by name; nothing here looks at a hand, a library or the current board.
 */
public final class CardRoles {
    private CardRoles() {}

    /** Printed-rules facts that never change during a game. */
    public record Role(int cmc,boolean creature,boolean sweeper,int sweepDamage,boolean counterspell,boolean graveyard) {
        /** A damage sweeper only kills creatures it can actually destroy. */
        public boolean sweeps(Card creature) {return sweeper && (sweepDamage<0 || creature.getNetToughness()<=sweepDamage);}
    }
    private static final Role UNKNOWN=new Role(0,false,false,-1,false,false);
    private static final Map<String,Role> CACHE=new ConcurrentHashMap<>();
    private static final List<String> GRAVEYARD_WORDS=List.of("flashback","dredge","retrace","escape","unearth","delve","disturb","embalm","eternalize","encore","jump-start","aftermath","scavenge","threshold","from your graveyard","in your graveyard","from a graveyard","cards in all graveyards");

    /** Spell, activated and enters-the-battlefield effects, including modes and chained effects. */
    public static List<SpellAbility> effects(Card card) {
        List<SpellAbility> result=new ArrayList<>();
        for(SpellAbility ability:card.getSpellAbilities())walk(ability,result,0);
        for(Trigger trigger:card.getTriggers()) {
            if(trigger.getMode()!=TriggerType.ChangesZone || !"Battlefield".equals(trigger.getParam("Destination")) || !"Card.Self".equals(trigger.getParam("ValidCard")))continue;
            try {walk(trigger.ensureAbility(),result,0);} catch(RuntimeException ignored) {/* An unusual trigger simply contributes nothing. */}
        }
        return result;
    }
    private static void walk(SpellAbility ability,List<SpellAbility> result,int depth) {
        if(ability==null || depth>6 || result.size()>48)return;
        result.add(ability);
        for(var list:ability.getAdditionalAbilityLists().values())for(var mode:list)walk(mode,result,depth+1);
        walk(ability.getSubAbility(),result,depth+1);
    }
    static int number(String text) {
        if(text==null || !text.matches("-?\\d{1,3}"))return Integer.MIN_VALUE;
        return Integer.parseInt(text);
    }
    private static boolean hitsCreatures(SpellAbility ability) {
        String valid=ability.getParamOrDefault("ValidCards","Creature");
        return valid.contains("Creature") || valid.contains("Permanent") || valid.equals("Card");
    }
    /** Board-wide creature removal: returns the damage dealt, -1 for unconditional, or MIN_VALUE if not a sweeper. */
    static int sweep(Card card,SpellAbility ability) {
        ApiType api=ability.getApi();if(api==null)return Integer.MIN_VALUE;
        switch(api) {
            case DestroyAll: case SacrificeAll: return hitsCreatures(ability)?-1:Integer.MIN_VALUE;
            case ChangeZoneAll: return ability.getParamOrDefault("Origin","").contains("Battlefield") && hitsCreatures(ability)?-1:Integer.MIN_VALUE;
            case DamageAll: {
                if(!ability.hasParam("ValidCards") || !hitsCreatures(ability))return Integer.MIN_VALUE;
                int damage=number(ability.getParam("NumDmg"));return damage>0?damage:-1;
            }
            case PumpAll: {
                int toughness=number(ability.getParam("NumDef"));
                return toughness<0 && toughness!=Integer.MIN_VALUE && hitsCreatures(ability)?-toughness:Integer.MIN_VALUE;
            }
            case DealDamage: case Destroy: case Pump: {
                // Overload turns "target" into "each".
                if(!card.hasStartOfKeyword("Overload") || !ability.getParamOrDefault("ValidTgts","").contains("Creature"))return Integer.MIN_VALUE;
                if(api==ApiType.Destroy)return -1;
                int amount=number(ability.getParam(api==ApiType.DealDamage?"NumDmg":"NumDef"));
                if(api==ApiType.Pump)return amount<0 && amount!=Integer.MIN_VALUE?-amount:Integer.MIN_VALUE;
                return amount>0?amount:-1;
            }
            default: return Integer.MIN_VALUE;
        }
    }
    static boolean usesGraveyard(Card card) {
        if(card.getRules()==null)return false;
        String text=card.getRules().getOracleText().toLowerCase(Locale.ROOT);
        for(String word:GRAVEYARD_WORDS)if(text.contains(word))return true;
        return false;
    }
    static Role describe(Card card) {
        boolean sweeper=false,counter=false;int damage=-1;
        for(SpellAbility ability:effects(card)) {
            int sweep=sweep(card,ability);
            if(sweep!=Integer.MIN_VALUE) {damage=sweeper?(damage<0 || sweep<0?-1:Math.max(damage,sweep)):sweep;sweeper=true;}
            if(ability.getApi()==ApiType.Counter && ability.getParamOrDefault("TargetType","Spell").contains("Spell"))counter=true;
        }
        return new Role(card.getCMC(),card.isCreature(),sweeper,damage,counter,usesGraveyard(card));
    }
    /** Looks a card up by printed name. The owner only supplies a game for Forge's card factory. */
    public static Role of(String name,Player anyPlayer) {
        Role cached=CACHE.get(name);if(cached!=null)return cached;
        Role role=UNKNOWN;
        try {
            PaperCard paper=StaticData.instance().getCommonCards().getCard(name);
            if(paper!=null)role=describe(Card.fromPaperCard(paper,anyPlayer));
        } catch(RuntimeException ignored) {/* Unreadable cards are treated as ordinary cards. */}
        CACHE.put(name,role);return role;
    }
}

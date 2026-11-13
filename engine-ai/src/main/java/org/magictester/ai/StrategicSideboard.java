/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.StaticData;
import forge.card.ColorSet;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.item.PaperCard;
import java.util.*;

/**
 * Sideboarding from what the opponent actually showed in earlier games of the match.
 *
 * Native Forge swaps same-cost cards at random, only after a loss, without looking at the opponent.
 * This planner asks one question of every card in the 75: is its interaction live against the cards
 * the opponent has publicly played? Removal with nothing to hit, graveyard hate against a deck that
 * never uses its graveyard and counterspells that cannot stop what was cast score low; sideboard
 * cards that line up well score high. Cards are exchanged one for one while the incoming card is
 * clearly better, so deck size, lands and mana sources are untouched. It is deterministic and reads
 * neither the opposing decklist nor any hidden zone.
 */
public final class StrategicSideboard {
    private StrategicSideboard() {}
    static final double NEUTRAL=60,MINIMUM_INCOMING=50,MARGIN=25;
    static final int MINIMUM_EVIDENCE=5;
    private static final String STATE_WORDS="attacking|blocking|blocked|unblocked|tapped|untapped|attackingOrBlocking|attackedThisTurn|enteredThisTurn|dealtDamageToYouThisTurn|wasDealtDamageThisTurn|kicked";

    record Seen(Card card,int copies,boolean land) {}

    /** The opposing deck as far as it has been revealed. All shares are of nonland copies. */
    static final class Profile {
        final List<Seen> cards=new ArrayList<>();
        double nonland,creatureShare,nonCreatureShare,cheapCreatureShare,burnShare,graveyardShare;
        int colors;
        static Profile of(Player opponent,Map<String,Integer> known) {
            Profile p=new Profile();double creatures=0,cheap=0,burn=0,grave=0;
            for(var entry:known.entrySet()) {
                PaperCard paper=StaticData.instance().getCommonCards().getCard(entry.getKey());if(paper==null)continue;
                Card card;try {card=Card.fromPaperCard(paper,opponent);} catch(RuntimeException unreadable) {continue;}
                int copies=Math.max(1,Math.min(4,entry.getValue()));
                p.cards.add(new Seen(card,copies,card.isLand()));
                if(card.isLand())continue;
                p.nonland+=copies;p.colors|=card.getRules().getColor().getColor();
                if(card.isCreature()) {creatures+=copies;if(card.getCMC()<=2)cheap+=copies;}
                else if(burns(card))burn+=copies;
                if(CardRoles.usesGraveyard(card))grave+=copies;
            }
            if(p.nonland>0) {
                p.creatureShare=creatures/p.nonland;p.nonCreatureShare=1-p.creatureShare;p.cheapCreatureShare=cheap/p.nonland;
                p.burnShare=burn/p.nonland;p.graveyardShare=grave/p.nonland;
            }
            return p;
        }
        private static boolean burns(Card card) {
            for(SpellAbility ability:CardRoles.effects(card))
                if(ability.getApi()==ApiType.DealDamage && ability.usesTargeting() && ability.getTargetRestrictions().canTgtPlayer())return true;
            return false;
        }
    }

    /** Drops qualifiers that only make sense on a live battlefield so printed cards can be tested. */
    static String[] printedFilter(String filter) {
        if("Any".equals(filter))return new String[]{"Creature","Planeswalker"};
        String[] parts=filter.split(",");
        for(int i=0;i<parts.length;i++) {
            int dot=parts[i].indexOf('.');if(dot<0)continue;
            List<String> kept=new ArrayList<>();
            for(String property:parts[i].substring(dot+1).split("\\+"))if(!property.matches("(non)?("+STATE_WORDS+")"))kept.add(property);
            parts[i]=kept.isEmpty()?parts[i].substring(0,dot):parts[i].substring(0,dot)+"."+String.join("+",kept);
        }
        return parts;
    }
    private static String targetFilter(SpellAbility ability) {
        return ability.hasParam("AITgts")?ability.getParam("AITgts"):ability.getParam("ValidTgts");
    }
    private static boolean matches(Card subject,String filter,Player actor,Card source,SpellAbility ability) {
        try {return subject.isValid(printedFilter(filter),actor,source,ability);} catch(RuntimeException unusual) {return false;}
    }
    /** Share of the opponent's revealed nonland cards this effect can hit; lands count a quarter. */
    private static double reach(Profile p,String filter,Player actor,Card source,SpellAbility ability,boolean permanentsOnly,int damage) {
        if(filter==null || p.nonland<=0)return 0;
        double weight=0;
        for(Seen seen:p.cards) {
            Card card=seen.card();
            if(permanentsOnly && !card.isPermanent())continue;
            if(!matches(card,filter,actor,source,ability))continue;
            if(damage>=0 && (card.isCreature()?card.getNetToughness()>damage:!card.isPlaneswalker()))continue;
            weight+=seen.copies()*(seen.land()?0.25:1);
        }
        return Math.min(1,weight/p.nonland);
    }
    private static double removal(double reach) {return reach<=0?5:Math.min(100,30+220*reach);}
    private static double own(List<Card> mine,String filter,Player actor,Card source,SpellAbility ability,int damage) {
        if(mine.isEmpty())return 0;
        int hit=0;
        for(Card card:mine)if(card.isPermanent() && matches(card,filter,actor,source,ability) && (damage<0 || (card.isCreature() && card.getNetToughness()<=damage)))hit++;
        return (double)hit/mine.size();
    }

    /** How well one effect lines up against the revealed deck, 0 to 100; NaN if it does not depend on the matchup. */
    static double effect(Player actor,Card source,SpellAbility ability,Profile p,List<Card> mine,boolean root) {
        ApiType api=ability.getApi();if(api==null)return Double.NaN;
        String filter=targetFilter(ability);
        switch(api) {
            case Counter: {
                if(filter==null || !ability.getParamOrDefault("TargetType","Spell").contains("Spell"))return Double.NaN;
                return 100*reach(p,filter,actor,source,ability,false,-1)*(0.45+0.45*p.nonCreatureShare);
            }
            case Destroy: return filter==null?Double.NaN:removal(reach(p,filter,actor,source,ability,true,-1));
            case DealDamage: {
                if(filter==null)return Double.NaN;
                int damage=CardRoles.number(ability.getParam("NumDmg"));
                double value=removal(reach(p,filter,actor,source,ability,true,damage>0?damage:-1));
                return ability.usesTargeting() && ability.getTargetRestrictions().canTgtPlayer()?Math.max(value,55):value;
            }
            case Pump: {
                int toughness=CardRoles.number(ability.getParam("NumDef"));
                if(filter==null || toughness>=0 || toughness==Integer.MIN_VALUE)return Double.NaN;
                return removal(reach(p,filter,actor,source,ability,true,-toughness));
            }
            case Attach: return filter!=null && ability.isCurse()?removal(reach(p,filter,actor,source,ability,true,-1)):Double.NaN;
            case Sacrifice: return ability.usesTargeting() && ability.getTargetRestrictions().canTgtPlayer()?removal(p.creatureShare*0.7):Double.NaN;
            case ChangeZone: {
                String origin=ability.getParamOrDefault("Origin",""),destination=ability.getParamOrDefault("Destination","");
                if(origin.contains("Graveyard") && destination.equals("Exile") && (filter!=null || ability.hasParam("DefinedPlayer")))return graveyardHate(p);
                if(filter==null || !origin.contains("Battlefield") || !List.of("Exile","Library","Graveyard","Hand").contains(destination))return Double.NaN;
                double value=removal(reach(p,filter,actor,source,ability,true,-1));
                return destination.equals("Hand")?value*0.6:value;
            }
            case ChangeZoneAll: {
                if(ability.getParamOrDefault("ChangeType","").contains("Targeted"))return Double.NaN; // follows a single target, not a sweeper
                if(ability.getParamOrDefault("Origin","").contains("Graveyard") && "Exile".equals(ability.getParam("Destination")))return graveyardHate(p);
                return sweeper(actor,source,ability,p,mine);
            }
            case DestroyAll: case DamageAll: case PumpAll: case SacrificeAll: return sweeper(actor,source,ability,p,mine);
            case Fog: return root && ability.isSpell()?20+90*p.creatureShare:Double.NaN;
            case ChooseSource: {
                // Colour-specific protection such as a Circle of Protection.
                var color=java.util.regex.Pattern.compile("(White|Blue|Black|Red|Green)Source").matcher(ability.getParamOrDefault("Choices",""));
                if(!color.find())return Double.NaN;
                return (p.colors&forge.card.MagicColor.fromName(color.group(1)))!=0?75:5;
            }
            case GainLife: return root && ability.isSpell() && !source.isPermanent()?25+75*Math.min(1,p.burnShare+p.cheapCreatureShare):Double.NaN;
            case Discard: return root && ability.isSpell() && ability.usesTargeting() && ability.getTargetRestrictions().canTgtPlayer()?30+60*p.nonCreatureShare:Double.NaN;
            default: return Double.NaN;
        }
    }
    private static double graveyardHate(Profile p) {return p.graveyardShare<=0.2?5:Math.min(100,20+270*p.graveyardShare);}
    private static double sweeper(Player actor,Card source,SpellAbility ability,Profile p,List<Card> mine) {
        int damage=CardRoles.sweep(source,ability);if(damage==Integer.MIN_VALUE)return Double.NaN;
        String filter=ability.getParamOrDefault("ValidCards","Creature");
        double theirs=reach(p,filter,actor,source,ability,true,damage),ours=own(mine,filter,actor,source,ability,damage);
        return Math.max(0,Math.min(100,30+110*theirs-110*ours));
    }

    /** One card against the revealed deck. Cards whose value does not depend on the matchup score NEUTRAL. */
    static double score(Player actor,Card card,Profile p,List<Card> mine) {
        double best=Double.NaN;
        for(SpellAbility ability:card.getSpellAbilities()) {
            if(ability.isManaAbility())continue;
            List<SpellAbility> chain=new ArrayList<>();collect(ability,chain,0);
            double value=Double.NaN;boolean dead=false;
            for(int i=0;i<chain.size();i++) {
                double current=effect(actor,card,chain.get(i),p,mine,i==0);
                if(Double.isNaN(current))continue;
                // A spell whose first, targeted effect has nothing to hit cannot be cast at all.
                if(i==0 && current<=5 && chain.get(i).usesTargeting())dead=true;
                value=Double.isNaN(value)?current:Math.max(value,current);
            }
            if(dead)value=5;
            if(!Double.isNaN(value))best=Double.isNaN(best)?value:Math.max(best,value);
        }
        for(SpellAbility ability:CardRoles.effects(card)) {
            if(card.getSpellAbilities().contains(ability) || ability.getRootAbility()==null || card.getSpellAbilities().contains(ability.getRootAbility()))continue;
            double value=effect(actor,card,ability,p,mine,false);
            if(!Double.isNaN(value))best=Double.isNaN(best)?value:Math.max(best,value);
        }
        // Auras such as Dead Weight carry their removal in a static effect rather than a spell effect.
        if(card.isAura() && "Curse".equals(card.getSVar("AttachAILogic")) && card.hasStartOfKeyword("Enchant:Creature")) {
            double value=removal(p.creatureShare);best=Double.isNaN(best)?value:Math.max(best,value);
        }
        boolean body=card.isCreature() || card.isPlaneswalker();
        double score=Double.isNaN(best)?NEUTRAL:body?Math.max(best,NEUTRAL-5):best;
        if(card.isCreature())for(var color:forge.card.MagicColor.Color.values())
            if(p.colors!=0 && (p.colors&color.getColorMask())!=0 && card.hasKeyword("Protection from "+color.getName().toLowerCase(Locale.ROOT)))score=Math.min(100,Math.max(score,NEUTRAL)+25);
        return score;
    }
    private static void collect(SpellAbility ability,List<SpellAbility> chain,int depth) {
        if(ability==null || depth>6)return;
        chain.add(ability);
        for(var list:ability.getAdditionalAbilityLists().values())for(var mode:list)collect(mode,chain,depth+1);
        collect(ability.getSubAbility(),chain,depth+1);
    }

    /** Returns the new main deck, or null to let native Forge decide. */
    public static List<PaperCard> plan(Player actor,Deck deck) {
        if(!AiPolicies.adaptive(actor) || actor.getGame().getRegisteredPlayers().size()!=2 || actor.getGame().getRules().getGameType().isCardPoolLimited())return null;
        try {return planned(actor,deck);}
        catch(RuntimeException unreadable) {
            // A card this planner cannot read must not end the match: native sideboarding takes over.
            AiPolicies.note(actor,"sideboard-fallback-native");return null;
        }
    }
    private static List<PaperCard> planned(Player actor,Deck deck) {
        Player opponent=null;for(Player p:actor.getGame().getRegisteredPlayers())if(p!=actor)opponent=p;
        if(opponent==null)return null;
        List<PaperCard> main=deck.get(DeckSection.Main).toFlatList(),side=deck.get(DeckSection.Sideboard).toFlatList();
        Profile profile=Profile.of(opponent,MatchMemory.known(opponent));
        if(profile.nonland<MINIMUM_EVIDENCE) {AiPolicies.note(actor,"sideboard-insufficient-evidence");return main;}

        Map<String,Card> cards=new HashMap<>();Map<String,Double> scores=new HashMap<>();
        List<Card> mine=new ArrayList<>();int colors=0;
        for(PaperCard paper:main) {
            Card card=cards.computeIfAbsent(paper.getName(),name->Card.fromPaperCard(paper,actor));
            if(!card.isLand()) {mine.add(card);colors|=paper.getRules().getColor().getColor();}
        }
        ColorSet deckColors=ColorSet.fromMask(colors);
        List<PaperCard> incoming=new ArrayList<>(),outgoing=new ArrayList<>();
        for(PaperCard paper:side) {
            if(paper.getRules().getAiHints().getRemAIDecks() || paper.getRules().getType().isLand() || !paper.getRules().getColor().hasNoColorsExcept(deckColors))continue;
            Card card=cards.computeIfAbsent(paper.getName(),name->Card.fromPaperCard(paper,actor));
            scores.computeIfAbsent(paper.getName(),name->score(actor,card,profile,mine));incoming.add(paper);
        }
        for(PaperCard paper:main) {
            Card card=cards.get(paper.getName());
            if(card.isLand() || !card.getManaAbilities().isEmpty())continue;
            scores.computeIfAbsent(paper.getName(),name->score(actor,card,profile,mine));outgoing.add(paper);
        }
        if(Boolean.getBoolean("magictester.ai.explain"))System.err.println("sideboard scores "+new TreeMap<>(scores));
        Comparator<PaperCard> byScore=Comparator.comparingDouble((PaperCard paper)->scores.get(paper.getName())).thenComparing(PaperCard::getName);
        incoming.sort(byScore.reversed());outgoing.sort(byScore);
        List<PaperCard> result=new ArrayList<>(main);int swaps=0;
        for(int i=0;i<Math.min(incoming.size(),outgoing.size());i++) {
            double in=scores.get(incoming.get(i).getName()),out=scores.get(outgoing.get(i).getName());
            if(in<MINIMUM_INCOMING || in-out<MARGIN)break;
            result.remove(outgoing.get(i));result.add(incoming.get(i));swaps++;
        }
        AiPolicies.note(actor,"sideboard-planned");
        for(int i=0;i<swaps;i++)AiPolicies.note(actor,"sideboard-cards-exchanged");
        return result;
    }
}

/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCostShard;
import forge.game.card.*;
import forge.game.keyword.Keyword;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import java.util.*;

/** Small, deterministic London-hand search. Reads only the acting player's hand. */
public final class StrategicHand {
    private StrategicHand() {}
    private static Integer sourceColors(Card land) {
        if(land.getManaAbilities().isEmpty())return null;
        int result=0;
        for(var mana:land.getManaAbilities()) {
            if(!Set.of("AB","Cost","Produced","Amount","SpellDescription","Description","ActivationZone","Secondary").containsAll(mana.getMapParams().keySet())
                    || !("T".equals(mana.getParam("Cost")) || "{T}".equals(mana.getParam("Cost")))
                    || !"1".equals(mana.getParamOrDefault("Amount","1")))return null;
            var part=mana.getManaPart();if(part==null)return null;
            if(part.getManaRestrictions()!=null && !part.getManaRestrictions().isEmpty())return null;
            if(part.getExtraManaRestriction()!=null && !part.getExtraManaRestriction().isEmpty())return null;
            String produced=part.getOrigProduced();
            if("Any".equals(produced)) {result|=31;continue;}
            if(produced==null || !produced.matches("[WUBRGC]"))return null;
            for(String token:produced.split(" "))result|=ManaAtom.fromName(token);
        }
        return result;
    }
    private static byte colors(List<Card> hand) {
        byte colors=0;
        for(Card c:hand)if(c.isLand()) {Integer value=sourceColors(c);if(value!=null)colors|=value;}
        return colors;
    }
    private static boolean supported(List<Card> hand) {
        for(Card c:hand) {
            if(c.isDoubleFaced() || c.isSplitCard() || c.isAdventureCard() || c.getManaCost().hasPhyrexian() || c.getManaCost().countX()>0)return false;
            if(!c.isLand() && c.getManaCost().isNoCost())return false;
            for(Keyword keyword:List.of(Keyword.AFFINITY,Keyword.CONVOKE,Keyword.DELVE,Keyword.IMPROVISE,Keyword.EVOKE,Keyword.EMERGE,Keyword.PROTOTYPE,Keyword.MORPH,Keyword.MEGAMORPH,Keyword.DISGUISE))
                if(c.hasKeyword(keyword))return false;
            if(c.isLand() && sourceColors(c)==null)return false;
            for(var ability:c.getSpellAbilities())if(ability.isCycling())return false;
            for(var shard:c.getManaCost())if(shard==ManaCostShard.S || shard.getCmc()>1)return false;
        }
        return true;
    }
    private static boolean canPay(Card spell,List<Card> hand) {
        var sources=new ArrayList<Integer>();for(Card c:hand)if(c.isLand()) {Integer mask=sourceColors(c);if(mask!=null)sources.add(mask);}
        if(spell.getManaCost().getCMC()>sources.size())return false;
        var needs=new ArrayList<Integer>();
        for(var shard:spell.getManaCost()) {
            int mask=shard==ManaCostShard.COLORLESS?ManaAtom.COLORLESS:shard.getColorMask();
            if(mask!=0)needs.add(mask);
        }
        return assign(needs,sources,0,0,new boolean[1<<sources.size()]);
    }
    private static boolean assign(List<Integer> needs,List<Integer> sources,int next,int used,boolean[] failed) {
        if(next==needs.size())return true;if(failed[used])return false;
        for(int i=0;i<sources.size();i++)if((used&(1<<i))==0 && (needs.get(next)&sources.get(i))!=0 && assign(needs,sources,next+1,used|(1<<i),failed))return true;
        failed[used]=true;return false;
    }
    /** No library order, opposing hand, draw prediction or random sampling. */
    public static int score(List<Card> hand) {
        int lands=0,cheap=0,castable=0,locked=0,spellValue=0;
        byte colors=colors(hand);
        for(Card c:hand) if(c.isLand()) lands++;
        for(Card c:hand) if(!c.isLand()) {
            int cmc=c.getManaCost().getCMC();
            boolean access=c.getManaCost().canBePaidWithAvailable(colors);
            if(access && canPay(c,hand)) {castable++;if(cmc<=1)cheap++;}
            if(!access) locked++;
            spellValue+=Math.max(0,12-cmc*2);
        }
        int landPenalty=lands==0?700:lands==1?(cheap>=4?30:230):lands<=3?0:lands==4?40:180+(lands-5)*80;
        return 400-landPenalty+castable*35+cheap*5-locked*45+spellValue;
    }
    private static List<Card> list(Iterable<Card> cards) {List<Card> result=new ArrayList<>();for(Card c:cards)result.add(c);return result;}
    private static List<Card> bestKept(List<Card> hand,int returned) {
        List<Card> best=null;int bestScore=Integer.MIN_VALUE;
        for(int mask=0;mask<(1<<hand.size());mask++) {
            AiCancellation.checkpoint();
            if(Integer.bitCount(mask)!=hand.size()-returned)continue;
            List<Card> kept=new ArrayList<>();for(int i=0;i<hand.size();i++)if((mask&(1<<i))!=0)kept.add(hand.get(i));
            int value=score(kept);if(value>bestScore) {best=kept;bestScore=value;}
        }
        return best;
    }
    public static boolean keep(Player actor,int returned,boolean nativeKeep) {
        if(!AiPolicies.strategic(actor))return nativeKeep;
        var hand=list(actor.getCardsIn(ZoneType.Hand));int size=hand.size()-returned;
        // Do not send unusual starting-hand sizes or low-card hands into an aggressive mulligan loop.
        if(hand.size()>7 || size<6 || returned<0 || returned>=hand.size())return nativeKeep;
        if(!supported(hand))return nativeKeep;
        var kept=bestKept(hand,returned);int lands=0,spells=0,early=0,oneDrops=0;
        byte colors=colors(kept);
        for(Card c:kept) {
            if(c.isLand()) {lands++;continue;}
            spells++;
            if(c.getManaCost().canBePaidWithAvailable(colors) && canPay(c,kept)) {
                early++;
                if(c.getManaCost().getCMC()<=1)oneDrops++;
            }
        }
        boolean decision=nativeKeep;
        if(lands>=2 && spells>=2 && early==0) decision=false;
        else if(lands==1 && oneDrops>=4 && kept.stream().anyMatch(Card::isBasicLand)) decision=true;
        if(decision!=nativeKeep)AiPolicies.note(actor,"mulligan-keep-changed");
        return decision;
    }
    public static CardCollection bottom(Player actor,CardCollectionView cards,int returned) {
        if(!AiPolicies.strategic(actor) || returned<1 || returned>3 || cards.size()>7 || cards.size()-returned<4)return null;
        var hand=list(cards);if(!supported(hand))return null;
        var kept=bestKept(hand,returned);var bottom=new CardCollection();
        for(Card c:hand)if(!kept.contains(c))bottom.add(c);
        AiPolicies.note(actor,"mulligan-bottom-selected");return bottom;
    }
}

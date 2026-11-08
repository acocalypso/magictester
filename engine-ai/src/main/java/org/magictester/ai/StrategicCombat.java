/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import forge.ai.ComputerUtilCard;
import forge.game.card.*;
import forge.game.GameType;
import forge.game.combat.*;
import forge.game.keyword.Keyword;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import java.util.*;

/** Bounded public-board search for basic combat. Unsupported mechanics retain native Forge. */
public final class StrategicCombat {
    private StrategicCombat() {}
    private static final Set<Keyword> BASIC=Set.of(Keyword.FLYING,Keyword.REACH,Keyword.HASTE,Keyword.VIGILANCE,Keyword.DEFENDER);
    private static boolean supported(Player actor) {
        if(!AiPolicies.strategic(actor) || actor.getGame().getRules().getGameType()!=GameType.Constructed || actor.getGame().getPlayers().size()!=2 || !actor.getGame().getCardsIn(ZoneType.Command).isEmpty())return false;
        for(Player p:actor.getGame().getPlayers()) if(p.cantLose() || p.cantLoseForZeroOrLessLife() || !p.canLoseLife() || p.getPreventNextDamageTotalShields()>0)return false;
        for(Card c:actor.getGame().getCardsIn(ZoneType.Battlefield)) {
            if(c.isBasicLand())continue;
            if(!c.isCreature() || c.getNetPower()<0 || c.getNetPower()>100 || c.getNetToughness()<=0 || c.getNetToughness()>100 || c.isEquipped()
                    || c.getDamage()>0 || c.getShieldCount()>0 || c.getCounters(CounterEnumType.SHIELD)>0 || c.getPreventNextDamageTotalShields()>0
                    || !c.getTriggers().isEmpty() || !c.getStaticAbilities().isEmpty() || !c.getReplacementEffects().isEmpty())return false;
            for(var kw:c.getKeywords()) if(!BASIC.contains(kw.getKeyword()))return false;
            for(var sa:c.getSpellAbilities())if(sa.isActivatedAbility())return false;
        }
        return true;
    }
    public static void attack(Player actor,Combat combat) {
        if(!supported(actor))return;
        Player opponent=actor.getOpponents().get(0);
        List<Card> attackers=new ArrayList<>(),blockers=new ArrayList<>();
        for(Card c:actor.getCreaturesInPlay()) if(CombatUtil.canAttack(c,opponent) && CombatUtil.getAttackCost(actor.getGame(),c,opponent)==null)attackers.add(c);
        for(Card c:opponent.getCreaturesInPlay())if(CombatUtil.canBlock(c))blockers.add(c);
        if(attackers.isEmpty() || attackers.size()>6 || blockers.size()>4)return;
        int total=0;for(Card c:attackers)total+=c.getNetPower();
        int prevented=maxPrevented(attackers,blockers,0,0);
        if(total-prevented<opponent.getLife())return;
        boolean changed=false;for(Card c:attackers)if(!combat.isAttacking(c)) {changed=true;break;}
        if(!changed)return;
        var original=new ArrayList<>(combat.getAttackers());
        for(Card c:attackers)combat.addAttacker(c,opponent);
        if(!CombatUtil.validateAttackers(combat)) {combat.clearAttackers();for(Card c:original)combat.addAttacker(c,opponent);return;}
        AiPolicies.note(actor,"combat-guaranteed-lethal");
    }
    private static int maxPrevented(List<Card> attackers,List<Card> blockers,int next,int blocked) {
        AiCancellation.checkpoint();if(next==blockers.size())return 0;
        int best=maxPrevented(attackers,blockers,next+1,blocked);
        for(int i=0;i<attackers.size();i++) if((blocked&(1<<i))==0 && CombatUtil.canBlock(attackers.get(i),blockers.get(next)))
            best=Math.max(best,attackers.get(i).getNetPower()+maxPrevented(attackers,blockers,next+1,blocked|(1<<i)));
        return best;
    }
    public static void block(Player actor,Combat combat) {
        if(!supported(actor))return;
        var attackers=new ArrayList<>(combat.getAttackers());List<Card> blockers=new ArrayList<>();
        for(Card c:actor.getCreaturesInPlay())if(CombatUtil.canBlock(c))blockers.add(c);
        if(attackers.isEmpty() || attackers.size()>5 || blockers.isEmpty() || blockers.size()>4)return;
        // Multi-block damage ordering is deliberately left to Forge.
        for(Card a:attackers) if(combat.getDefenderByAttacker(a)!=actor || combat.getBlockers(a).size()>1)return;
        int[] original=new int[blockers.size()];Arrays.fill(original,-1);
        for(int i=0;i<blockers.size();i++) {
            var blocked=combat.getAttackersBlockedBy(blockers.get(i));if(blocked.size()>1)return;
            if(!blocked.isEmpty())original[i]=attackers.indexOf(blocked.get(0));
        }
        var search=new BlockSearch(actor,attackers,blockers,original);search.visit(0,0,new int[blockers.size()]);
        if(search.bestScore>=search.originalScore)return;
        for(Card blocker:blockers)combat.undoBlockingAssignment(blocker);
        for(int i=0;i<blockers.size();i++)if(search.best[i]>=0)combat.addBlocker(attackers.get(search.best[i]),blockers.get(i));
        if(CombatUtil.validateBlocks(combat,actor)!=null) {
            for(Card blocker:blockers)combat.undoBlockingAssignment(blocker);
            for(int i=0;i<blockers.size();i++)if(original[i]>=0)combat.addBlocker(attackers.get(original[i]),blockers.get(i));
            return;
        }
        AiPolicies.note(actor,"combat-block-search");
    }
    private static final class BlockSearch {
        final Player actor;final List<Card> attackers,blockers;final boolean[][] legal;
        final int[] attackPower,attackToughness,attackValue,blockPower,blockToughness,blockValue;
        final long originalScore;long bestScore;int[] best;
        BlockSearch(Player actor,List<Card> attackers,List<Card> blockers,int[] original) {
            this.actor=actor;this.attackers=attackers;this.blockers=blockers;this.best=original.clone();
            attackPower=attackers.stream().mapToInt(Card::getNetPower).toArray();attackToughness=attackers.stream().mapToInt(Card::getNetToughness).toArray();attackValue=attackers.stream().mapToInt(ComputerUtilCard::evaluateCreature).toArray();
            blockPower=blockers.stream().mapToInt(Card::getNetPower).toArray();blockToughness=blockers.stream().mapToInt(Card::getNetToughness).toArray();blockValue=blockers.stream().mapToInt(ComputerUtilCard::evaluateCreature).toArray();
            legal=new boolean[blockers.size()][attackers.size()];
            for(int b=0;b<blockers.size();b++)for(int a=0;a<attackers.size();a++)legal[b][a]=CombatUtil.canBlock(attackers.get(a),blockers.get(b));
            bestScore=originalScore=score(original);
        }
        long score(int[] assignment) {
            int damage=0,loss=0;boolean[] blocked=new boolean[attackers.size()];
            for(int b=0;b<blockers.size();b++)if(assignment[b]>=0) {
                int a=assignment[b];blocked[a]=true;
                if(attackPower[a]>=blockToughness[b])loss+=blockValue[b];
                if(blockPower[b]>=attackToughness[a])loss-=attackValue[a];
            }
            for(int a=0;a<attackers.size();a++)if(!blocked[a])damage+=attackPower[a];
            return (damage>=actor.getLife()?1_000_000L:0)+damage*10L+loss;
        }
        void visit(int next,int used,int[] assignments) {
            AiCancellation.checkpoint();
            if(next==blockers.size()) {long score=score(assignments);if(score<bestScore) {bestScore=score;best=assignments.clone();}return;}
            assignments[next]=-1;visit(next+1,used,assignments);
            for(int a=0;a<attackers.size();a++)if((used&(1<<a))==0 && legal[next][a]) {assignments[next]=a;visit(next+1,used|(1<<a),assignments);}
        }
    }
}

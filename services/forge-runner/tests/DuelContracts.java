/* SPDX-License-Identifier: GPL-3.0-only
 * Direct checks of actual engine rules; these are not played benchmark games.
 */
import forge.GuiDesktop;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.StaticData;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.*;
import forge.game.card.*;
import forge.game.cost.CostAdjustment;
import forge.game.player.*;
import forge.game.spellability.SpellAbility;
import forge.game.staticability.StaticAbilityCantBeCast;
import forge.game.zone.ZoneType;
import forge.player.GamePlayerUtil;
import java.util.*;

public class DuelContracts {
    static int assertions=0;
    static void check(boolean value,String message) {assertions++;if(!value) throw new AssertionError(message);}
    static SpellAbility spell(Card card,Player player) {
        for(SpellAbility ability:card.getSpellAbilities()) if(ability.isSpell()) {ability.setActivatingPlayer(player);return ability;}
        throw new AssertionError("No native spell for "+card.getName());
    }
    static Game game(boolean duel) {
        System.setProperty("magictester.duel",Boolean.toString(duel));
        GameRules rules=new GameRules(GameType.Commander);rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        List<RegisteredPlayer> registered=new ArrayList<>();
        for(int i=0;i<2;i++) {
            Deck deck=new Deck("contract-"+i);
            deck.getMain().add(StaticData.instance().getCommonCards().getCard("Mountain"),98);
            deck.getOrCreate(DeckSection.Commander).add(StaticData.instance().getCommonCards().getCard("Bruse Tarl, Boorish Herder"),1);
            deck.getOrCreate(DeckSection.Commander).add(StaticData.instance().getCommonCards().getCard("Kediss, Emberclaw Familiar"),1);
            RegisteredPlayer player=RegisteredPlayer.forCommander(deck);player.setStartingLife(duel?20:40);
            player.setPlayer(GamePlayerUtil.createAiPlayer("contract-"+i,i,"Default"));registered.add(player);
        }
        Match match=new Match(rules,registered,"Duel contract");Game game=match.createGame();game.setNoGUIUser();
        for(int i=0;i<2;i++) {
            Player player=game.getRegisteredPlayers().get(i);player.setLife(duel?20:40,null);
            for(var paper:registered.get(i).getCommanders()) {
                Card card=Card.fromPaperCard(paper,player);player.addCommander(card);player.getZone(ZoneType.Command).add(card);
            }
        }
        return game;
    }
    public static void main(String[] args) {
        try {
            System.setProperty("java.awt.headless","true");GuiBase.setInterface(new GuiDesktop());FModel.initialize(null,null);
            StaticData.instance().setMulliganRule(forge.MulliganDefs.MulliganRule.London);
            check(StaticData.instance().getMulliganRule()==forge.MulliganDefs.MulliganRule.London,"London mulligans are pinned");
            Game duel=game(true);Player owner=duel.getRegisteredPlayers().get(0),victim=duel.getRegisteredPlayers().get(1);
            check(duel.getPlayers().size()==2 && !duel.getRules().hasAppliedVariant(GameType.Brawl),"Duel has no free first mulligan under native MulliganService");
            check(owner.getLife()==20,"Duel starts at 20 life");
            check(duel.getRules().hasAppliedVariant(GameType.Commander),"Commander zone-return rules remain enabled");
            Card first=owner.getCommanders().get(0),other=owner.getCommanders().get(1);
            first.setCastFrom(owner.getZone(ZoneType.Command));other.setCastFrom(owner.getZone(ZoneType.Command));
            check(!StaticAbilityCantBeCast.cantBeCastAbility(spell(first,owner),first,owner),"Either first commander is initially castable");
            check(!StaticAbilityCantBeCast.cantBeCastAbility(spell(other,owner),other,owner),"The second choice is initially castable");
            SpellAbility firstSpell=spell(first,owner);
            int initialCost=CostAdjustment.adjust(firstSpell.getPayCosts(),firstSpell,false).getTotalMana().getCMC();
            owner.incCommanderCast(first);
            int recastCost=CostAdjustment.adjust(firstSpell.getPayCosts(),firstSpell,false).getTotalMana().getCMC();
            check(recastCost==initialCost+2,"The selected commander retains its native two-mana tax");
            check(StaticAbilityCantBeCast.cantBeCastAbility(spell(other,owner),other,owner),"Other commander is locked in the command zone");
            check(!StaticAbilityCantBeCast.cantBeCastAbility(spell(first,owner),first,owner),"Selected commander can be recast");
            owner.getZone(ZoneType.Command).remove(other);owner.getZone(ZoneType.Hand).add(other);other.setCastFrom(owner.getZone(ZoneType.Hand));
            check(!StaticAbilityCantBeCast.cantBeCastAbility(spell(other,owner),other,owner),"Other commander can be cast from hand");
            victim.addCommanderDamage(first,21);check(!victim.checkLoseCondition(),"21 commander damage does not end Duel");
            victim.setLife(0,null);check(victim.checkLoseCondition(),"Ordinary zero-life loss remains active");
            Game commander=game(false);Player p0=commander.getRegisteredPlayers().get(0),p1=commander.getRegisteredPlayers().get(1);
            Card c0=p0.getCommanders().get(0),c1=p0.getCommanders().get(1);p0.incCommanderCast(c0);c1.setCastFrom(p0.getZone(ZoneType.Command));
            check(!StaticAbilityCantBeCast.cantBeCastAbility(spell(c1,p0),c1,p0),"Normal Commander permits the other partner");
            p1.addCommanderDamage(c0,21);check(p1.checkLoseCondition(),"Normal Commander retains its 21-damage loss");
            System.out.println("{\"event\":\"duel_contract_passed\",\"assertions\":"+assertions+"}");System.exit(0);
        } catch(Throwable error) {error.printStackTrace();System.exit(1);}
    }
}

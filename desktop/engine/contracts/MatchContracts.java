/* SPDX-License-Identifier: GPL-3.0-only
 * Engine rule contracts only. Programmatic draws here are not played games.
 */
import forge.GuiDesktop;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.StaticData;
import forge.deck.*;
import forge.game.*;
import forge.game.player.*;
import forge.player.GamePlayerUtil;
import java.util.*;
public class MatchContracts {
    static int assertions=0;
    static void check(boolean value,String message){assertions++;if(!value) throw new AssertionError(message);}
    public static void main(String[] args) {
        try {
            System.setProperty("java.awt.headless","true");GuiBase.setInterface(new GuiDesktop());FModel.initialize(null,null);
            GameRules rules=new GameRules(GameType.Constructed);rules.setGamesPerMatch(3);rules.setAISideboardingEnabled(true);
            List<RegisteredPlayer> registered=new ArrayList<>();
            for(int i=0;i<2;i++) {Deck deck=new Deck("match-contract-"+i);deck.getMain().add(StaticData.instance().getCommonCards().getCard("Forest"),60);deck.getOrCreate(DeckSection.Sideboard).add(StaticData.instance().getCommonCards().getCard("Runeclaw Bear"),1);RegisteredPlayer p=new RegisteredPlayer(deck);p.setPlayer(GamePlayerUtil.createAiPlayer("contract-"+i,i,"Default"));registered.add(p);}
            Match match=new Match(rules,registered,"contract");
            check(rules.getGamesToWinMatch()==2,"BO3 requires two wins");
            for(int i=0;i<3;i++) {Game game=match.createGame();game.setNoGUIUser();for(Player player:game.getRegisteredPlayers()) player.intentionalDraw();game.setGameOver(GameEndReason.Draw);check(!match.isMatchOver(),"Draws do not satisfy the two-win condition");}
            Game next=match.createGame();next.setNoGUIUser();
            var main=next.getRegisteredPlayers().get(0).getController().sideboard(registered.get(0).getDeck(),GameType.Constructed,"draw contract");
            check(main!=null && main.size()==60,"Native AI can sideboard after a draw without a missing-winner exception");
            System.out.println("{\"event\":\"match_contract_passed\",\"assertions\":"+assertions+"}");System.exit(0);
        }catch(Throwable error){error.printStackTrace();System.exit(1);}
    }
}

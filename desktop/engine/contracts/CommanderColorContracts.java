/* SPDX-License-Identifier: GPL-3.0-only
 * Direct pregame checks, not claimed played games.
 */
import forge.GuiDesktop;import forge.gui.GuiBase;import forge.model.FModel;import forge.StaticData;import forge.deck.*;import forge.game.*;import forge.game.card.*;import forge.game.player.*;import forge.player.GamePlayerUtil;import java.util.*;
public class CommanderColorContracts {
 static int assertions=0;
 static void check(boolean value,String message){assertions++;if(!value)throw new AssertionError(message);}
 static Deck deck(String commander,String partner,String land){
  Deck deck=new Deck("color-contract");var cards=StaticData.instance().getCommonCards();deck.getMain().add(cards.getCard(land),98);deck.getOrCreate(DeckSection.Commander).add(cards.getCard(commander),1);deck.getOrCreate(DeckSection.Commander).add(cards.getCard(partner),1);return deck;
 }
 static List<String> chosen(Deck deck,String name){
  MagicTesterBridge.configureCommanderColors(deck,0);
  List<RegisteredPlayer> roster=new ArrayList<>();for(int i=0;i<2;i++){RegisteredPlayer rp=RegisteredPlayer.forCommander(deck);rp.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(rp);}
  Match match=new Match(new GameRules(GameType.Commander),roster,"color-contract");Game game=match.createGame();Player player=game.getRegisteredPlayers().get(0);Card card=Card.fromPaperCard(StaticData.instance().getCommonCards().getCard(name),player);player.initCommanderColor(card);return com.google.common.collect.Lists.newArrayList(card.getChosenColors());
 }
 public static void main(String[]args){try{
  System.setProperty("java.awt.headless","true");GuiBase.setInterface(new GuiDesktop());FModel.initialize(null,null);
  String piper="The Prismatic Piper",tymna="Tymna the Weaver";
  Deck green=deck(piper,tymna,"Swamp");green.getMain().remove(StaticData.instance().getCommonCards().getCard("Swamp"),1);green.getMain().add(StaticData.instance().getCommonCards().getCard("Forest"),1);
  check(chosen(green,piper).equals(List.of("green")),"Forest outside Tymna's identity requires green, despite an empty opening hand");
  check(chosen(deck(piper,tymna,"Swamp"),piper).equals(List.of("white")),"A fully covered deck allows deterministic white");
  Deck companion=deck(piper,tymna,"Swamp");companion.getOrCreate(DeckSection.Sideboard).add(StaticData.instance().getCommonCards().getCard("Umori, the Collector"),1);
  check(chosen(companion,piper).equals(List.of("green")),"Declared companion's identity participates in the starting deck choice");
  check(chosen(deck("Faceless One","Sword Coast Sailor","Mountain"),"Faceless One").equals(List.of("red")),"Faceless One can choose its required non-background color");
  green.getMain().remove(StaticData.instance().getCommonCards().getCard("Swamp"),1);green.getMain().add(StaticData.instance().getCommonCards().getCard("Mountain"),1);boolean rejected=false;try{MagicTesterBridge.configureCommanderColors(green,0);}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"One wild color cannot cover two missing colors");
  System.out.println("{\"event\":\"commander_color_contract_passed\",\"assertions\":"+assertions+"}");System.exit(0);
 }catch(Throwable error){error.printStackTrace();System.exit(1);}}
}

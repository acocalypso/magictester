/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.engine.AndroidForgeBridge;
import forge.ai.ComputerUtilMana;
import forge.game.ability.*;
import forge.game.*;
import forge.game.card.Card;
import forge.game.player.*;
import forge.game.replacement.ReplacementType;
import forge.game.zone.ZoneType;
import forge.deck.*;
import forge.player.GamePlayerUtil;
import forge.StaticData;
import java.util.*;
import java.util.concurrent.CancellationException;

/** Verifies actual patched native entry points observe interruption before doing more work. */
public final class NativeCancellationContracts {
    interface Checked {void run()throws Exception;}
    static void cancelled(Checked operation)throws Exception {
        Thread.currentThread().interrupt();
        try {operation.run();throw new AssertionError("Native evaluation ignored interruption");}
        catch(CancellationException expected) {}
        finally {Thread.interrupted();}
    }
    public static void main(String[] args)throws Exception {
        AndroidForgeBridge.initialize(args[0],s->{});
        cancelled(()->AbilityUtils.calculateAmount(null,"3",null));
        var group=ComputerUtilMana.class.getDeclaredMethod("groupSourcesByManaColor",Player.class,boolean.class);group.setAccessible(true);

        var roster=new ArrayList<RegisteredPlayer>();
        for(int i=0;i<2;i++) {var p=new RegisteredPlayer(new Deck("cancellation"));p.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(p);}
        var game=new Match(new GameRules(GameType.Constructed),roster,"cancellation-contract").createGame();
        var owner=game.getRegisteredPlayers().get(0);
        cancelled(()->{try {group.invoke(null,owner,false);}catch(java.lang.reflect.InvocationTargetException e) {if(e.getCause() instanceof CancellationException)throw (CancellationException)e.getCause();throw e;}});
        var card=Card.fromPaperCard(StaticData.instance().getCommonCards().getCard("Mountain"),owner);owner.getZone(ZoneType.Battlefield).add(card);
        cancelled(()->game.getReplacementHandler().getReplacementList(ReplacementType.Tap,AbilityKey.mapFromAffected(card),null));
        System.out.println("Native amount, mana and replacement interruption contracts passed");System.exit(0);
    }
}

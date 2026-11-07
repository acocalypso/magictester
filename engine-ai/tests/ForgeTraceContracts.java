/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.*;
import org.magictester.engine.AndroidForgeBridge;
import forge.game.*;
import forge.game.card.Card;
import forge.game.player.*;
import forge.game.zone.ZoneType;
import forge.deck.*;
import forge.player.GamePlayerUtil;
import forge.StaticData;
import com.google.gson.*;
import java.util.*;

public final class ForgeTraceContracts {
    static void check(boolean ok,String message) {if(!ok)throw new AssertionError(message);}
    static Card card(Game game,Player owner,String name,ZoneType zone) {
        Card c=Card.fromPaperCard(StaticData.instance().getCommonCards().getCard(name),owner);
        owner.getZone(zone).add(c);return c;
    }
    public static void main(String[] args) {
        AndroidForgeBridge.initialize(args[0],s->{});
        var roster=new ArrayList<RegisteredPlayer>();
        for(int i=0;i<2;i++) {var r=new RegisteredPlayer(new Deck("trace"));r.setPlayer(GamePlayerUtil.createAiPlayer("player-"+i,i,"Default"));roster.add(r);}
        var match=new Match(new GameRules(GameType.Constructed),roster,"trace-contract");var game=match.createGame();
        var actor=game.getRegisteredPlayers().get(0);var opponent=game.getRegisteredPlayers().get(1);
        var own=card(game,actor,"Lightning Bolt",ZoneType.Hand);
        var secret=card(game,opponent,"Black Lotus",ZoneType.Hand);
        card(game,actor,"Ancestral Recall",ZoneType.Library);
        var visible=card(game,opponent,"Grizzly Bears",ZoneType.Battlefield);
        check(ForgeDecisionTrace.begin(actor,List.of(visible),null,false)==null,"Capture must be opt in");
        ForgeDecisionTrace.open(game,true,7);
        var choice=ForgeDecisionTrace.begin(actor,List.of(own,visible,secret),null,false);
        check(choice!=null,"Actual Forge adapter should capture supplied options");
        ForgeDecisionTrace.complete(choice,visible,actor);
        var result=ForgeDecisionTrace.close(game,true);String json=new Gson().toJson(result);
        check(json.contains("Lightning Bolt"),"Actor may see own hand");
        check(!json.contains("Black Lotus"),"Opponent hidden identity must not leak, even in masked options");
        check(!json.contains("Ancestral Recall"),"Library identities and order must not enter the observation");
        check(json.contains("Grizzly Bears"),"Public battlefield visible");
        check(json.contains("card:"+visible.getId()),"Return references native chosen entity");
        check(ForgeDecisionTrace.close(game,true)==null,"Game unregisters its recorder");
        // Exercise the actual patched controller, rather than only calling the observer directly.
        var ability=forge.game.ability.AbilityFactory.getAbility("AB$ ChangeZone | Cost$ 1 B | Origin$ Library | Destination$ Hand | ChangeType$ Card | ChangeNum$ 1",own);
        ability.setActivatingPlayer(actor);
        var options=new forge.util.collect.FCollection<Card>();options.add(own);options.add(visible);
        forge.util.MyRandom.setRandom(new Random(19));
        var baseline=actor.getController().chooseSingleEntityForEffect(options,null,ability,"trace",false,actor,Map.of());
        ForgeDecisionTrace.open(game,true,19);
        forge.util.MyRandom.setRandom(new Random(19));
        var recorded=actor.getController().chooseSingleEntityForEffect(options,null,ability,"trace",false,actor,Map.of());
        check(recorded==baseline,"Recording must preserve the native choice for this fixture");
        var hooked=ForgeDecisionTrace.close(game,true);
        check(((List<?>)hooked.get("records")).size()==1,"Patched controller must invoke recorder exactly once");
        check((Boolean)hooked.get("completeForCoveredChoices"),"Native hook completed");
        System.out.println("Forge visibility, native hook and choice parity contracts passed");System.exit(0);
    }
}

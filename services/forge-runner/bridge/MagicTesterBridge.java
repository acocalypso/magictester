/* SPDX-License-Identifier: GPL-3.0-only
 * MagicTester bridge for Forge 2.0.15. Uses the public engine API without
 * reimplementing card resolution or modifying the upstream release.
 */
import com.google.common.eventbus.Subscribe;
import com.google.gson.*;
import forge.GuiDesktop;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.*;
import forge.game.card.Card;
import forge.game.event.*;
import forge.game.player.*;
import forge.player.GamePlayerUtil;
import forge.util.MyRandom;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public class MagicTesterBridge {
    static final String PREFIX = "@@MAGICTESTER ";
    static final String VERSION = "1";
    static final Gson JSON = new GsonBuilder().serializeNulls().create();
    static void emit(Object value) { System.out.println(PREFIX + JSON.toJson(value)); System.out.flush(); }
    static class Request {
        String[] decks;
        int games, seed, clockSeconds, startIndex;
        String mode;
    }
    public static void main(String[] args) {
        try {
            Thread.setDefaultUncaughtExceptionHandler((thread,error) -> {error.printStackTrace(); System.exit(1);});
            System.setProperty("java.awt.headless","true");
            System.setProperty("file.encoding","UTF-8");
            GuiBase.setInterface(new GuiDesktop());
            FModel.initialize(null,null);
            Request request = JSON.fromJson(Files.readString(Path.of(args[0])),Request.class);
            if (request.decks.length < 2 || request.decks.length > 4 || request.games < 1 || request.clockSeconds < 1) throw new IllegalArgumentException("Invalid bridge request");
            boolean commander = "commander".equals(request.mode);
            GameType type = commander ? GameType.Commander : GameType.Constructed;
            for (int index=request.startIndex; index<request.games; index++) {
                int gameSeed = (int)(((long)request.seed + (long)index * 1009) % 2147483647L);
                MyRandom.setRandom(new Random(gameSeed));
                GameRules rules = new GameRules(type);
                rules.setAppliedVariants(EnumSet.of(type));
                rules.setGamesPerMatch(1);
                List<RegisteredPlayer> registered = new ArrayList<>();
                for (int seat=0;seat<request.decks.length;seat++) {
                    Deck deck=DeckSerializer.fromFile(new File(request.decks[seat]));
                    if (deck==null || deck.getMain().isEmpty()) throw new IllegalArgumentException("Could not load deck "+seat);
                    RegisteredPlayer player=commander ? RegisteredPlayer.forCommander(deck) : new RegisteredPlayer(deck);
                    player.setPlayer(GamePlayerUtil.createAiPlayer("player-"+seat,seat,"Default"));
                    registered.add(player);
                }
                Match match=new Match(rules,registered,"MagicTester");
                ObservedGame game=new ObservedGame(registered,rules,match);
                game.setNoGUIUser();
                Recorder recorder=new Recorder(game);
                game.recorder=recorder;
                game.subscribeToEvents(recorder);
                emit(Map.of("type","game_started","index",index,"gameSeed",gameSeed,"bridgeVersion",VERSION));
                long start=System.nanoTime();
                String termination="normal";
                ExecutorService executor=Executors.newSingleThreadExecutor(r -> {Thread t=new Thread(r,"forge-game");t.setDaemon(true);return t;});
                Future<?> running=executor.submit(() -> match.startGame(game));
                try { running.get(request.clockSeconds,TimeUnit.SECONDS); }
                catch (TimeoutException timeout) {termination="timeout";running.cancel(true);}
                catch (ExecutionException error) {termination="engine_error";error.getCause().printStackTrace();}
                finally {executor.shutdownNow();}
                boolean ended=termination.equals("normal") && game.isGameOver() && game.getOutcome()!=null;
                if (termination.equals("normal") && (!ended || recorder.eventError)) termination="engine_error";
                if (termination.equals("normal") && game.getOutcome().isDraw()) termination="rule_draw";
                Integer winner=null;
                if (termination.equals("normal")) {
                    for (Player player:game.getRegisteredPlayers()) if (player.getOutcome()!=null && player.getOutcome().hasWon()) winner=recorder.seat(player);
                    if (winner==null) termination="engine_error";
                }
                // Read game state only after the engine thread has finished. A timed-out
                // JVM exits immediately after its result; it is never reused for another game.
                Map<String,Object> result=new LinkedHashMap<>();
                result.put("index",index);result.put("batchIndex",index);
                result.put("engine","forge");result.put("engineVersion","2.0.15");
                result.put("bridgeVersion",VERSION);result.put("seed",request.seed);result.put("gameSeed",gameSeed);
                result.put("durationMs",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start));
                result.put("termination",termination);result.put("winner",winner);
                result.put("turns",termination.equals("normal") || termination.equals("rule_draw") ? game.getOutcome().getLastTurnNumber() : null);
                result.put("startingPlayer",recorder.startingPlayer);
                result.put("startingLife",recorder.startingLife);
                List<Map<String,Object>> players=new ArrayList<>();
                for(int seat=0;seat<registered.size();seat++) {
                    Map<String,Object> player=new LinkedHashMap<>();player.put("id","player-"+seat);
                    player.put("placement",winner==null ? null : (winner==seat ? 1 : recorder.placements.get(seat)));
                    players.add(player);
                }
                result.put("players",players);
                result.put("commanderCasts",recorder.commanderCasts);
                result.put("eliminations",recorder.eliminations);
                emit(Map.of("type","result","result",result));
                if (termination.equals("timeout") || termination.equals("engine_error")) System.exit(75);
                // The native log remains useful for auditing individual engine decisions.
                var log=new ArrayList<>(game.getGameLog().getLogEntries(null));Collections.reverse(log);
                for(var entry:log) System.out.println(entry);
            }
            System.exit(0);
        } catch(Throwable error) {error.printStackTrace();System.exit(1);}
    }
    public static class ObservedGame extends Game {
        Recorder recorder;
        ObservedGame(List<RegisteredPlayer> players,GameRules rules,Match match) {super(players,rules,match);}
        @Override public void onPlayerLost(Player player) {
            // Forge marks every loser in a single state-based check before this hook.
            // Capture that group once, before removal changes the active-player list.
            if(recorder!=null) recorder.losses();
            super.onPlayerLost(player);
        }
    }
    public static class Recorder {
        final Game game;
        final Map<Integer,Integer> placements=new LinkedHashMap<>();
        final List<Map<String,Object>> eliminations=new CopyOnWriteArrayList<>();
        final List<Map<String,Object>> commanderCasts=new CopyOnWriteArrayList<>();
        volatile Integer startingPlayer=null;
        final List<Integer> startingLife=new CopyOnWriteArrayList<>();
        volatile boolean eventError=false;
        Recorder(Game game) {this.game=game;}
        int seat(Player player) {for(int i=0;i<game.getMatch().getPlayers().size();i++) if(game.getMatch().getPlayers().get(i).getPlayer().equals(player.getLobbyPlayer())) return i;throw new IllegalStateException("Unknown engine player");}
        void losses() {
            List<Integer> group=new ArrayList<>();Map<String,String> reasons=new LinkedHashMap<>();
            for(Player player:game.getRegisteredPlayers()) if(player.getOutcome()!=null && player.getOutcome().lossState!=null && !placements.containsKey(seat(player))) {
                group.add(seat(player));reasons.put(Integer.toString(seat(player)),player.getOutcome().lossState.name());
            }
            if(group.isEmpty()) return;
            int placement=game.getRegisteredPlayers().size()-placements.size()-group.size()+1;
            for(int seat:group) placements.put(seat,placement);
            eliminations.add(Map.of("players",group,"placement",placement,"turn",game.getPhaseHandler().getTurn(),"reasons",reasons));
        }
        @Subscribe public void event(GameEvent event) {
            try {
                if(event instanceof GameEventGameStarted started) {
                    for(Player player:game.getRegisteredPlayers()) { if(player.getView().equals(started.firstTurn())) startingPlayer=seat(player);startingLife.add(player.getLife()); }
                }
                if(event instanceof GameEventSpellAbilityCast cast && cast.sa().isSpell()) {
                    Card card=game.findByView(cast.sa().getHostCard());
                    if(card!=null && card.isRealCommander()) {
                        Player caster=card.getCastSA().getActivatingPlayer();
                        commanderCasts.add(Map.of("player",seat(caster),"card",card.getName(),"turn",game.getPhaseHandler().getTurn(),"playerTurn",caster.getTurn(),"from",card.getCastFrom()==null ? "Unknown" : card.getCastFrom().getZoneType().name()));
                    }
                }
            } catch(Throwable error) {eventError=true;error.printStackTrace();}
        }
    }
}

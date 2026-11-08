package org.magictester.engine;

/* SPDX-License-Identifier: GPL-3.0-only
 * Maintained Forge 2.0.15 bridge. Public engine API plus pinned opt-in overrides.
 */
import com.google.common.eventbus.Subscribe;
import com.google.gson.*;
import java.util.function.Consumer;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.deck.io.DeckSerializer;
import forge.game.*;
import forge.game.card.Card;
import forge.game.event.*;
import forge.game.player.*;
import forge.player.GamePlayerUtil;
import forge.util.MyRandom;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class AndroidForgeBridge {
    static Consumer<String> output = System.out::println;
    static boolean initialized;
    public static synchronized void initialize(String assets, Consumer<String> progress) {
        if (initialized) return;
        System.setProperty("magictester.engineVersion",EngineVersion.VALUE);
        GuiBase.setInterface(AndroidGui.create(assets));
        GuiBase.setIsAndroid(true);
        System.setProperty("magictester.lazyCards", "true");
        FModel.initialize(null, prefs -> {
            prefs.setPref(forge.localinstance.properties.ForgePreferences.FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(forge.localinstance.properties.ForgePreferences.FPref.DECKGEN_CARDBASED, false);
            prefs.setPref(forge.localinstance.properties.ForgePreferences.FPref.UI_ENABLE_SOUNDS, false);
            prefs.setPref(forge.localinstance.properties.ForgePreferences.FPref.UI_ENABLE_MUSIC, false);
            return null;
        });
        forge.StaticData.instance().setMulliganRule(forge.MulliganDefs.MulliganRule.London);
        initialized = true;
        progress.accept("Engine initialized");
    }
    static final String PREFIX = "@@MAGICTESTER ";
    static final String VERSION = "2";
    static List<GameLogEntry> pendingLog=List.of();
    static void dumpLog() {pendingLog=List.of();}
    static final Gson JSON = new GsonBuilder().serializeNulls().create();
    static void emit(Object value) {output.accept(JSON.toJson(value));}
    static class Request {
        String[] decks,companions,aiPolicies;
        int[] indices;
        int games,seed,clockSeconds,startIndex,bestOf,maxMatchGames;
        boolean sideboarding,captureDecisions;
        String mode;
    }
    public static void configureCommanderColors(Deck deck,int seat) {
        int fixed=0,required=0;List<forge.item.PaperCard> wild=new ArrayList<>();
        var commanders=deck.get(DeckSection.Commander);
        if(commanders==null) return;
        for(var entry:commanders) {
            var card=entry.getKey();fixed|=card.getRules().getColorIdentity().getColor();
            if(card.getRules().getAddsWildCardColor()) wild.add(card);
        }
        if(wild.isEmpty()) return;
        for(var section:deck) for(var entry:section.getValue()) required|=entry.getKey().getRules().getColorIdentity().getColor();
        required&=~fixed;
        if(Integer.bitCount(required)>wild.size()) throw new IllegalArgumentException("Starting deck requires more commander colors than available choices");
        wild.sort(Comparator.comparing(forge.item.PaperCard::getName));
        for(var card:wild) {
            int chosen=required==0?1:Integer.lowestOneBit(required);required&=~chosen;
            System.setProperty("magictester.commanderColor.player-"+seat+"."+card.getName(),forge.card.MagicColor.toLongString((byte)chosen));
        }
    }
    static List<Map<String,Object>> players(Integer winner,int count,Map<Integer,Integer> placements) {
        List<Map<String,Object>> values=new ArrayList<>();
        for(int i=0;i<count;i++) {Map<String,Object> p=new LinkedHashMap<>();p.put("id","player-"+i);p.put("placement",winner==null?null:(winner==i?1:placements.get(i)));values.add(p);}
        return values;
    }
    static Map<String,Integer> main(RegisteredPlayer player) {
        Map<String,Integer> counts=new TreeMap<>();
        for(var entry:player.getDeck().getMain()) counts.merge(entry.getKey().getName(),entry.getValue(),Integer::sum);
        return counts;
    }
    static List<Map<String,Object>> difference(Map<String,Integer> after,Map<String,Integer> before) {
        List<Map<String,Object>> changes=new ArrayList<>();
        for(var entry:after.entrySet()) {int quantity=entry.getValue()-before.getOrDefault(entry.getKey(),0);if(quantity>0) changes.add(Map.of("name",entry.getKey(),"quantity",quantity));}
        return changes;
    }
    static Map<String,Object> play(Match match,List<RegisteredPlayer> registered,Request request,int unitIndex,int gameIndex,int resultIndex,int resultSeed,int gameSeed) throws Exception {
        MyRandom.setRandom(new Random(gameSeed));
        List<Map<String,Integer>> previous=new ArrayList<>();for(var p:registered) previous.add(main(p));
        ObservedGame game=new ObservedGame(registered,match.getRules(),match);game.setNoGUIUser();
        Recorder recorder=new Recorder(game,registered,previous,request,gameIndex);game.recorder=recorder;game.subscribeToEvents(recorder);
        ActionRecorder actions=new ActionRecorder(game,recorder);game.getGameLog().addObserver(actions);
        org.magictester.ai.AiPolicies.open(game,request.aiPolicies);
        org.magictester.ai.ForgeDecisionTrace.open(game,request.captureDecisions,gameSeed);
        emit(Map.of("type","game_started","index",unitIndex,"gameIndex",gameIndex,"gameSeed",gameSeed,"bridgeVersion",VERSION));
        long started=System.nanoTime();String termination="normal";
        ExecutorService executor=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"forge-game");t.setDaemon(true);return t;});
        Future<?> running=executor.submit(()->match.startGame(game,recorder::captureSetup));
        try {running.get(request.clockSeconds,TimeUnit.SECONDS);}
        catch(TimeoutException timeout) {termination="timeout";running.cancel(true);}
        catch(ExecutionException error) {termination="engine_error";error.getCause().printStackTrace();}
        finally {executor.shutdownNow();}
        boolean ended=termination.equals("normal") && game.isGameOver() && game.getOutcome()!=null;
        if(termination.equals("normal") && (!ended || recorder.eventError)) termination="engine_error";
        if(termination.equals("normal") && game.getOutcome().isDraw()) termination="rule_draw";
        Integer winner=null;
        if(termination.equals("normal")) {
            for(Player p:game.getRegisteredPlayers()) if(p.getOutcome()!=null && p.getOutcome().hasWon()) winner=recorder.seat(p);
            if(winner==null || recorder.placements.size()!=registered.size()-1) termination="engine_error";
        }
        if(!termination.equals("normal")) winner=null;
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("unit","game");result.put("index",resultIndex);result.put("batchIndex",resultIndex);
        result.put("engine","forge");result.put("engineVersion",EngineVersion.VALUE);result.put("bridgeVersion",VERSION);
        result.put("clockSeconds",request.clockSeconds);result.put("mode",request.mode);result.put("mulliganRule","London");result.put("seed",resultSeed);result.put("gameSeed",gameSeed);
        result.put("durationMs",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started));result.put("termination",termination);result.put("winner",winner);
        result.put("turns",ended?game.getOutcome().getLastTurnNumber():null);result.put("startingPlayer",recorder.startingPlayer);
        result.put("startingLife",new ArrayList<>(recorder.startingLife));result.put("players",players(winner,registered.size(),recorder.placements));
        result.put("commanderCasts",new ArrayList<>(recorder.commanderCasts));result.put("eliminations",new ArrayList<>(recorder.eliminations));
        result.put("sideboardChanges",recorder.setupComplete?new ArrayList<>(recorder.sideboardChanges):null);
        result.put("commanderColors",recorder.setupComplete?new ArrayList<>(recorder.commanderColors):null);
        result.put("companionSelections",recorder.setupComplete?new ArrayList<>(recorder.companionSelections):null);
        result.put("ai",org.magictester.ai.AiPolicies.close(game));
        result.put("actionLog",actions.finish(termination.equals("normal") || termination.equals("rule_draw")));
        var decisionTrace=org.magictester.ai.ForgeDecisionTrace.close(game,termination.equals("normal") || termination.equals("rule_draw"));
        if(decisionTrace!=null) result.put("decisionTrace",decisionTrace);
        if(termination.equals("normal") || termination.equals("rule_draw")) {
            var log=new ArrayList<>(game.getGameLog().getLogEntries(null));Collections.reverse(log);pendingLog=log;
        }
        emit(Map.of("type","game_finished","index",unitIndex,"gameIndex",gameIndex,"gameSeed",gameSeed,"durationMs",result.get("durationMs"),"termination",termination,"clockSeconds",request.clockSeconds));
        return result;
    }
    public static synchronized void execute(String requestJson, Consumer<String> events) {
        output = events;
        try {
            forge.StaticData.instance().setMulliganRule(forge.MulliganDefs.MulliganRule.London);
            Request request=JSON.fromJson(requestJson,Request.class);
            if(request.decks.length<2 || request.decks.length>4 || request.games<1 || request.clockSeconds<1) throw new IllegalArgumentException("Invalid bridge request");
            org.magictester.ai.AiPolicies.validate(request.aiPolicies,request.decks.length);
            if(request.bestOf!=0 && request.bestOf!=1 && request.bestOf!=3) throw new IllegalArgumentException("Unsupported match mode");
            int bestOf=request.bestOf==3?3:1,limit=request.maxMatchGames==0?5:request.maxMatchGames;
            if(bestOf==3 && (request.decks.length!=2 || limit<3 || limit>9)) throw new IllegalArgumentException("Invalid BO3 limits");
            boolean duel="duel".equals(request.mode),commander=duel || "commander".equals(request.mode);
            System.setProperty("magictester.duel",Boolean.toString(duel));
            if(duel && request.decks.length!=2) throw new IllegalArgumentException("Duel requires two players");
            GameType type=commander?GameType.Commander:GameType.Constructed;
            int[] indices=request.indices;
            if(indices==null) {indices=new int[request.games];for(int i=0;i<request.games;i++) indices[i]=i;}
            int previous=-1;
            for(int value:indices) {if(value<=previous || value<0 || value>=request.games) throw new IllegalArgumentException("Invalid unit indices");previous=value;}
            for(int offset=request.startIndex;offset<indices.length;offset++) {
                int index=indices[offset];
                int unitSeed=(int)(((long)request.seed+(long)index*1009)%2147483647L);MyRandom.setRandom(new Random(unitSeed));
                GameRules rules=new GameRules(type);rules.setAppliedVariants(EnumSet.of(type));rules.setGamesPerMatch(bestOf);
                rules.setAISideboardingEnabled(bestOf==3 && request.sideboarding);
                List<RegisteredPlayer> registered=new ArrayList<>();
                for(int seat=0;seat<request.decks.length;seat++) {
                    Deck deck=DeckSerializer.fromFile(new File(request.decks[seat]));
                    if(deck==null || deck.getMain().isEmpty()) throw new IllegalArgumentException("Could not load deck "+seat);
                    for(var section:deck) for(var entry:section.getValue()) {
                        if(entry.getKey().getRules()==null || entry.getKey().getRules().isUnsupported()) throw new IllegalArgumentException("Pinned Forge cannot load card: "+entry.getKey().getName());
                    }
                    if(commander) configureCommanderColors(deck,seat);
                    RegisteredPlayer player=commander?RegisteredPlayer.forCommander(deck):new RegisteredPlayer(deck);if(duel) player.setStartingLife(20);
                    player.setPlayer(GamePlayerUtil.createAiPlayer("player-"+seat,seat,"Default"));registered.add(player);
                    System.setProperty("magictester.companion.player-"+seat,request.companions!=null && request.companions[seat]!=null?request.companions[seat]:"");
                }
                Match match=new Match(rules,registered,"MagicTester");
                if(bestOf==1) {
                    Map<String,Object> result=play(match,registered,request,index,0,index,request.seed,unitSeed);
                    emit(Map.of("type","result","result",result));dumpLog();
                    if(List.of("timeout","engine_error").contains(result.get("termination"))) return;
                    continue;
                }
                long matchStarted=System.nanoTime();List<Map<String,Object>> games=new ArrayList<>();String termination="normal";
                for(int gameIndex=0;gameIndex<limit && !match.isMatchOver();gameIndex++) {
                    int gameSeed=(int)(((long)unitSeed+(long)gameIndex*307)%2147483647L);
                    Map<String,Object> game=play(match,registered,request,index,gameIndex,gameIndex,unitSeed,gameSeed);games.add(game);
                    emit(Map.of("type","match_game","matchIndex",index,"result",game));dumpLog();
                    if(List.of("timeout","engine_error").contains(game.get("termination"))) {termination=(String)game.get("termination");break;}
                }
                Integer winner=null;
                if(termination.equals("normal")) {
                    if(!match.isMatchOver()) termination="game_limit";
                    else {winner=registered.indexOf(match.getWinner());if(winner<0) {winner=null;termination="engine_error";}}
                }
                List<Integer> wins=new ArrayList<>(List.of(0,0));
                for(var game:games) if(game.get("termination").equals("normal")) {int seat=((Number)game.get("winner")).intValue();wins.set(seat,wins.get(seat)+1);}
                Map<String,Object> result=new LinkedHashMap<>();
                result.put("unit","match");result.put("bestOf",3);result.put("index",index);result.put("batchIndex",index);
                result.put("engine","forge");result.put("engineVersion",EngineVersion.VALUE);result.put("bridgeVersion",VERSION);result.put("clockSeconds",request.clockSeconds);result.put("mode",request.mode);result.put("mulliganRule","London");
                result.put("seed",request.seed);result.put("gameSeed",unitSeed);result.put("winner",winner);result.put("termination",termination);
                result.put("players",players(winner,2,Map.of(0,2,1,2)));result.put("turns",null);result.put("startingPlayer",null);
                result.put("durationMs",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-matchStarted));result.put("gameWins",wins);result.put("games",games);result.put("sideboarding",request.sideboarding);
                emit(Map.of("type","result","result",result));
                if(List.of("timeout","engine_error").contains(termination)) return;
            }
            emit(Map.of("type", "batch_complete"));
        } catch(Throwable error) {error.printStackTrace();emit(Map.of("type","error","message",error.toString()));}
    }
    // Observe Forge's own formatted log synchronously, including games stopped by the clock.
    // Recording is bounded and cannot change a game outcome if an entry cannot be captured.
    @SuppressWarnings("deprecation")
    public static class ActionRecorder implements Observer {
        static final int MAX_ENTRIES=5000,MAX_BYTES=262144,MAX_TEXT=4096;
        final Game game;final Recorder recorder;
        final List<Map<String,Object>> entries=new ArrayList<>();
        int total=0,bytes=0;boolean truncated=false,closed=false,full=false;
        ActionRecorder(Game game,Recorder recorder) {this.game=game;this.recorder=recorder;}
        @Override public synchronized void update(Observable source,Object ignored) {
            if(closed) return;
            int sequence=total++;
            if(full) return;
            try {
                if(entries.size()>=MAX_ENTRIES) {truncated=true;full=true;return;}
                var nativeEntries=game.getGameLog().getAllEntries();
                var entry=nativeEntries.get(nativeEntries.size()-1);
                String text=entry.message();
                if(text.length()>MAX_TEXT) {text=text.substring(0,MAX_TEXT-1)+"…";truncated=true;}
                int size=text.getBytes(StandardCharsets.UTF_8).length;
                if(bytes+size>MAX_BYTES) {truncated=true;full=true;return;}
                var phase=game.getPhaseHandler();
                Map<String,Object> value=new LinkedHashMap<>();
                value.put("sequence",sequence);value.put("kind",entry.type().name());value.put("text",text);
                value.put("turn",Math.max(0,phase.getTurn()));value.put("phase",phase.getPhase()==null?null:phase.getPhase().name());
                value.put("activePlayer",phase.getPlayerTurn()==null?null:recorder.seat(phase.getPlayerTurn()));
                entries.add(value);bytes+=size;
            } catch(Throwable error) {truncated=true;full=true;}
        }
        synchronized Map<String,Object> finish(boolean ended) {
            closed=true;game.getGameLog().deleteObserver(this);
            return Map.of("version",1,"entries",new ArrayList<>(entries),"total",total,"complete",ended&&!truncated);
        }
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
        final List<RegisteredPlayer> registered;
        final List<Map<String,Integer>> previous;
        final Request request;
        final int gameIndex;
        final List<Map<String,Object>> commanderColors=new CopyOnWriteArrayList<>();
        final List<Map<String,Object>> sideboardChanges=new CopyOnWriteArrayList<>(),companionSelections=new CopyOnWriteArrayList<>();
        volatile boolean setupComplete=false;
        Recorder(Game game,List<RegisteredPlayer> registered,List<Map<String,Integer>> previous,Request request,int gameIndex) {this.game=game;this.registered=registered;this.previous=previous;this.request=request;this.gameIndex=gameIndex;}
        void captureSetup() {
            boolean missing=false;
            for(int i=0;i<registered.size();i++) {
                Map<String,Integer> current=main(registered.get(i));int size=0;for(int quantity:current.values()) size+=quantity;
                int side=0;var pool=registered.get(i).getDeck().get(DeckSection.Sideboard);if(pool!=null) for(var entry:pool) side+=entry.getValue();
                sideboardChanges.add(Map.of("player",i,"added",difference(current,previous.get(i)),"removed",difference(previous.get(i),current),"mainboardSize",size,"sideboardSize",side));
                String declared=request.companions==null?null:request.companions[i],selected=null;
                for(Card card:game.getRegisteredPlayers().get(i).getCardsIn(forge.game.zone.ZoneType.Command)) if(!card.isCommander() && card.hasKeyword(forge.game.keyword.Keyword.COMPANION)) selected=card.getName();
                for(Card commander:game.getRegisteredPlayers().get(i).getCommanders()) if(commander.getRules().getAddsWildCardColor()) commanderColors.add(Map.of("player",i,"card",commander.getName(),"colors",com.google.common.collect.Lists.newArrayList(commander.getChosenColors())));
                Map<String,Object> choice=new LinkedHashMap<>();choice.put("player",i);choice.put("declared",declared);choice.put("selected",selected);companionSelections.add(choice);
                if(gameIndex==0 && declared!=null && !declared.equals(selected)) missing=true;
            }
            setupComplete=true;
            if(missing) throw new IllegalStateException("Pinned Forge could not select the validated companion");
        }
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

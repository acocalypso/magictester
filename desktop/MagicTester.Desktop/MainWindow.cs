using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Controls.Templates;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
namespace MagicTester.Desktop;
public sealed class MainWindow : Window
{
    readonly TabControl tabs = new();
    readonly TextBlock connection = Text("Starting the local engine…"), capacity = Text(""), message = Text(""), setupProgress = Text(""), poolInfo = Text(""), summary = Text(""), resultTitle = Text("Select a run from the queue."), validation = Text("");
    readonly ComboBox format = new(), pool = new(), gameMode = new(), distribution = new();
    readonly TextBox name = new() { Text = "My deck" }, deck = new() { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 400, PlaceholderText = "Commander\n1 Your Commander\n\nDeck\n…remaining cards…", FontFamily = new FontFamily("monospace") }, link = new() { PlaceholderText = "Moxfield or Archidekt public deck URL" };
    readonly NumericUpDown matchLimit = new() { Minimum = 3, Maximum = 9, Value = 5, Increment = 1, FormatString = "0" };
    readonly Control matchLimitField;
    readonly NumericUpDown games = new() { Minimum = 1, Maximum = 1000, Value = 50, Increment = 1 }, clock = new() { Minimum = 5, Maximum = 300, Value = 30, Increment = 30 }, seed = new() { Minimum = 0, Maximum = 2147483646, Value = 12345, Increment = 1 };
    readonly CheckBox sideboard = new() { Content = "Native Forge sideboarding in BO3", IsChecked = true }, repeated = new() { Content = "Allow repeated opponent lists in Commander pods", IsChecked = true, IsVisible = false }, autoMeta = new() { Content = "Fetch each format’s meta daily while the app is open", IsChecked = true };
    readonly StackPanel opponentRows = new() { Spacing = 6 }, podRows = new() { Spacing = 6 }, matchupPanel = new() { Spacing = 6 }, settingsLog = new() { Spacing = 4 };
    readonly ListBox queue = new(), runs = new(), observations = new();
    readonly List<OpponentChoice> opponentChoices = [];
    readonly List<PodChoice> pods = [];
    readonly Button start, addPod;
    readonly TabItem resultsTab, queueTab;
    WorkerClient? worker;
    FileStream? instanceLock;
    DispatcherTimer? timer;
    string? selectedJob;
    string revision = "";
    int runPage, observationPage;
    bool polling, closing;
    JsonNode? results;
    sealed record Row(JsonNode Data, string Label) { public override string ToString() => Label; }
    sealed record FormatChoice(string Id, string Name) { public override string ToString() => Name; }
    sealed record OpponentChoice(JsonNode Deck, CheckBox Selected, NumericUpDown Weight);
    sealed record PodChoice(string[] Ids, string Label, decimal Weight);
    static readonly FormatChoice[] Formats = [new("standard", "Standard"), new("pioneer", "Pioneer"), new("modern", "Modern"), new("pauper", "Pauper"), new("legacy", "Legacy"), new("vintage", "Vintage"), new("commander", "Commander"), new("cedh", "cEDH"), new("duel", "Duel Commander")];
    public MainWindow()
    {
        Title = "MagicTester · Desktop"; Width = 1180; Height = 860; MinWidth = 840; MinHeight = 620;
        Background = new SolidColorBrush(Color.Parse("#151719")); Foreground = Brushes.WhiteSmoke;
        FontFamily = new FontFamily("Segoe UI, DejaVu Sans"); FontSize = 14;
        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(24, 18) };
        header.Children.Add(new StackPanel { Children = { new TextBlock { Text = "MagicTester", FontSize = 28, FontWeight = FontWeight.SemiBold }, Text("The local deck testing workbench") } });
        Grid.SetColumn(connection, 1); header.Children.Add(connection);
        var root = new DockPanel(); DockPanel.SetDock(header, Dock.Top); root.Children.Add(header);
        var footer = new StackPanel { Margin = new Thickness(24, 10), Spacing = 4, Children = { message, Text("Real Forge AI games · saved inputs · no cloud account · all fonts local") } }; DockPanel.SetDock(footer, Dock.Bottom); root.Children.Add(footer);
        tabs.Margin = new Thickness(20, 0); root.Children.Add(tabs); Content = root;
        format.ItemsSource = Formats; format.SelectedIndex = 3;
        distribution.ItemsSource = new[] { "Equal allocation", "Source-reported meta shares", "Custom weights" }; distribution.SelectedIndex = 0;
        gameMode.ItemsSource = new[] { "BO1", "BO3" }; gameMode.SelectedIndex = 0;
        pool.SelectionChanged += (_, _) => BuildOpponents();
        start = Button("Analyze deck", StartRun);
        addPod = Button("Add explicit Commander pod…", AddPod); addPod.IsVisible = false;
        format.SelectionChanged += async (_, _) => { clock.Value = IsCommander ? 300 : 30; gameMode.ItemsSource = FormatId is "commander" or "cedh" ? new[] { "BO1" } : new[] { "BO1", "BO3" }; gameMode.SelectedIndex = 0; sideboard.IsEnabled = !IsCommander; sideboard.IsChecked = !IsCommander; sideboard.IsVisible = !IsCommander && gameMode.SelectedItem?.ToString() == "BO3"; repeated.IsVisible = FormatId is "commander" or "cedh"; addPod.IsVisible = repeated.IsVisible; podRows.IsVisible = repeated.IsVisible; await Safe(LoadPools); };
        matchLimitField = Field("Maximum games in one BO3 match", matchLimit); matchLimitField.IsVisible = false;
        void UpdateMatchLimit() { bool match = gameMode.SelectedItem?.ToString() == "BO3"; matchLimitField.IsVisible = match; sideboard.IsVisible = match && !IsCommander; games.Maximum = match ? Math.Floor(1000 / (matchLimit.Value ?? 5)) : 1000; if (games.Value > games.Maximum) games.Value = games.Maximum; }
        gameMode.SelectionChanged += (_, _) => UpdateMatchLimit(); matchLimit.ValueChanged += (_, _) => UpdateMatchLimit(); sideboard.IsVisible = false;
        var inputs = Stack(Field("Deck name", name), Field("Format", format), Field("Opponent pool", pool), poolInfo, RowPanel(Button("Refresh current meta", RefreshMeta), Button("Reference / pool decklists", ShowPoolDecks)), Field("Allocation", distribution), new ScrollViewer { Content = opponentRows, MaxHeight = 200 }, repeated, addPod, podRows, Field("Mode", gameMode), matchLimitField, sideboard, Field("Games / matches", games), Field("Game time limit (seconds)", clock), Field("Random seed", seed), start);
        var left = Stack(Field("Decklist", deck), RowPanel(Button("Open deck file…", OpenDeck), Button("Load example", LoadExample), Button("Validate deck", Validate)), validation, Field("Import a public deck link", link), Button("Import deck link", ImportLink), Text("How it works\nYour deck is validated against cached card data and Forge scripts. Forge’s AI then plays the planned opponents. BO3 preserves sideboarding between games; Commander uses four seats. Results exclude unfinished games and keep the recorded actions. AI play is a benchmark, not a prediction of human tournament performance."));
        var workbench = new Grid { ColumnDefinitions = new ColumnDefinitions("3*,24,2*") }; workbench.Children.Add(left); Grid.SetColumn(inputs, 2); workbench.Children.Add(inputs);
        tabs.Items.Add(Tab("Test a deck", workbench));
        queue.MinHeight = 280; queue.MaxHeight = 480;
        foreach (var list in new[] { queue, runs, observations }) {
            list.ItemTemplate = new FuncDataTemplate<Row>((row, _) => Text(row?.Label ?? ""));
            ScrollViewer.SetHorizontalScrollBarVisibility(list, Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled);
        }
        queue.DoubleTapped += async (_, _) => await Safe(OpenSelectedRun);
        queueTab = Tab("Queue", Stack(capacity, RowPanel(Button("Open results", OpenSelectedRun), Button("Cancel", CancelSelected), Button("Retry with settings…", RetrySelected)), queue, Text("Closing MagicTester preserves checkpoints. Unfinished work resumes when you open the app again."))); tabs.Items.Add(queueTab);
        resultsTab = Tab("Results", Stack(resultTitle, summary, RowPanel(Button("Refresh results", () => LoadResults(selectedJob)), Button("Your decklist", ShowYourDeck), Button("Retry with settings…", RetryResult), Button("Export JSON / CSV…", ExportResults)), matchupPanel, Text("Games and matches"), runs, RowPanel(Button("Previous page", async () => { runPage = Math.Max(0, runPage - 1); await LoadRuns(); }), Button("Next page", async () => { runPage++; await LoadRuns(); }), Button("Game details / actions", OpenRunDetails)), Text("Recorded BO3 games, including earlier attempts"), observations, RowPanel(Button("Previous observations", async () => { observationPage = Math.Max(0, observationPage - 1); await LoadObservations(); }), Button("Next observations", async () => { observationPage++; await LoadObservations(); }), Button("Open recorded game", OpenObservation))));
        runs.MaxHeight = 260; runs.MinHeight = 120; observations.MaxHeight = 200;
        runs.DoubleTapped += async (_, _) => await Safe(OpenRunDetails); observations.DoubleTapped += async (_, _) => await Safe(OpenObservation); tabs.Items.Add(resultsTab);
        tabs.Items.Add(Tab("Opponent pools", Stack(Text("Daily sources and saved pools", 24), Text("Each daily pool keeps its reporting window, source, shares and decklists. Commander sourcing uses a competitive cEDH population, not a universal casual Commander meta. Reference pools are integration decks, not tournament data."), Button("Refresh selected format’s daily pool", RefreshMeta), Button("Import JSON or CSV pool…", ImportPool), Button("Inspect selected pool decklists", ShowPoolDecks), autoMeta, Button("Save refresh preference", async () => { await Call("preferences", new { autoMeta = autoMeta.IsChecked == true }); message.Text = "Refresh preference saved."; }))));
        tabs.Items.Add(Tab("Setup & information", Stack(Text("Your local engine", 24), Text("Release packages include .NET, Node and a Java 21 JDK. First setup downloads verified Forge and card data, then validates real engine contracts. It can take several minutes and needs internet and free disk space. Latest stable Forge is checked hourly; metadata is refreshed daily while the app is open. Cached games need a stable-version check from the last 26 hours."), Button("Download / update and validate Forge", SetupEngine), Button("Refresh card metadata and validate Forge", async () => await SetupEngine(true)), setupProgress, settingsLog, Button("Open local data folder", OpenDataFolder), Text("Resource limits\nThe engine checks allocated CPUs and free memory before starting JVMs. The default budget is two CPU cores and a 1 GiB Java heap plus 512 MiB overhead per JVM, with additional memory headroom. Capacity is shared across analyses; it falls when memory is scarce. Games inside one BO3 stay sequential. No result is fabricated or inferred from a timeout."), Text("Deck format\nPut commanders under a Commander heading and the other cards under Deck. Commander decks total 100 cards including eligible commander pairs. Companions have their own Companion heading. Formats and card support are validated before play."), Text("History and retry\nEvery game can show recorded actions in turn order. Partial logs and older attempts are labelled. Resume retains completed checkpoints and the old clock; retrying with a new clock starts a separate run with the same saved opponents and seeds."))));
        Opened += async (_, _) => await Safe(StartWorker);
        Closing += OnClosing;
    }
    string FormatId => (format.SelectedItem as FormatChoice)?.Id ?? "pauper";
    bool IsCommander => FormatId is "commander" or "cedh" or "duel";
    static TextBlock Text(string value, double size = 14) => new() { Text = value, FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = new SolidColorBrush(Color.Parse("#C0C5CC")), Margin = new Thickness(0, 3) };
    static StackPanel Stack(params Control[] controls) { var stack = new StackPanel { Spacing = 12 }; foreach (var c in controls) stack.Children.Add(c); return stack; }
    static StackPanel RowPanel(params Control[] controls) { var stack = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; foreach (var c in controls) stack.Children.Add(c); return stack; }
    static Control Field(string label, Control field) { Avalonia.Automation.AutomationProperties.SetName(field, label); return Stack(Text(label), field); }
    static TabItem Tab(string title, Control content) => new() { Header = title, Content = new ScrollViewer { Content = content, Margin = new Thickness(12, 18), HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled } };
    Button Button(string label, Func<Task> action) { var button = new Button { Content = label, Padding = new Thickness(12, 8) }; button.Click += async (_, _) => await Safe(action); return button; }
    async Task Safe(Func<Task> action) { try { await action(); } catch (Exception error) { message.Text = error.Message; message.Foreground = new SolidColorBrush(Color.Parse("#E8A5A5")); } }
    Task<JsonNode?> Call(string method, object? args = null) => worker?.CallAsync(method, args) ?? throw new InvalidOperationException("The local engine is not ready");
    static string S(JsonNode? value, string key = "") => key.Length == 0 ? value?.ToString() ?? "" : value?[key]?.ToString() ?? "";
    static int N(JsonNode? value, string key) => value?[key]?.GetValue<int>() ?? 0;
    static string Percent(JsonNode? value) => value is null ? "Not available" : value.GetValue<double>().ToString("P1", CultureInfo.CurrentCulture);
    async Task StartWorker()
    {
        var data = Environment.GetEnvironmentVariable("MAGICTESTER_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MagicTester"); Directory.CreateDirectory(data);
        instanceLock = new FileStream(Path.Combine(data, "desktop-ui.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        worker = new WorkerClient(); worker.Notification += (kind, payload) => Dispatcher.UIThread.Post(() => { if (kind == "setup") { setupProgress.Text = S(payload, "message"); settingsLog.Children.Add(Text(S(payload, "message"))); if (settingsLog.Children.Count > 40) settingsLog.Children.RemoveAt(0); } else if (kind is "warning" or "disconnected") message.Text = S(payload, "message").Length == 0 ? S(payload) : S(payload, "message"); });
        await Refresh(); await LoadPools();
        timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) }; timer.Tick += async (_, _) => { if (polling || closing) return; polling = true; try { await Safe(Refresh); } finally { polling = false; } }; timer.Start();
    }
    async Task Refresh()
    {
        var state = await Call("status"); bool ready = state?["ready"]?.GetValue<bool>() == true;
        connection.Text = ready ? "Local workspace · Forge " + S(state?["forge"], "engineVersion") : "Setup required";
        start.IsEnabled = ready && state?["setupBusy"]?.GetValue<bool>() != true;
        var r = state?["resources"]; capacity.Text = $"{S(r, "active")} running batches · {S(r, "waiting")} waiting · up to {S(r, "max")} in parallel\n{S(r, "cpuCores")} CPU cores · {S(r, "availableMemoryMiB")} MiB available RAM · {S(r, "reason")}";
        if (!ready) setupProgress.Text = S(state, "setupError");
        string? selection = (queue.SelectedItem as Row)?.Data["id"]?.ToString();
        var rows = state?["jobs"]?.AsArray().Select(j => new Row(j!.DeepClone(), $"{S(j?["input"], "name")}  ·  {S(j?["input"], "format")}  ·  {S(j, "state")}  ·  {S(j, "completed")}/{S(j?["input"], "games")} units  ·  {S(j?["input"], "clockSeconds")} s/game")).ToList() ?? [];
        queue.ItemsSource = rows; queue.SelectedItem = rows.FirstOrDefault(row => S(row.Data, "id") == selection);
        if (selectedJob is { } id && tabs.SelectedItem == resultsTab) { var job = rows.FirstOrDefault(row => S(row.Data, "id") == id)?.Data; string version = S(job, "state") + ":" + S(job, "completed") + ":" + S(job, "failed"); if (version != revision) { revision = version; await LoadResults(id, false); } }
    }
    async Task LoadPools()
    {
        if (worker is null) return;
        string? selected = (pool.SelectedItem as Row)?.Data["id"]?.ToString();
        var values = (await Call("snapshots", new { format = FormatId }))?.AsArray().Select(s => new Row(s!.DeepClone(), S(s, "name"))).ToList() ?? [];
        pool.ItemsSource = values; pool.SelectedItem = values.FirstOrDefault(v => S(v.Data, "id") == selected) ?? values.FirstOrDefault();
        BuildOpponents();
    }
    void BuildOpponents()
    {
        opponentChoices.Clear(); opponentRows.Children.Clear(); pods.Clear(); podRows.Children.Clear();
        if (pool.SelectedItem is not Row selected) { poolInfo.Text = "Complete setup or import a pool to begin."; return; }
        var doc = selected.Data; poolInfo.Text = S(doc, "source") + "\nAs of " + S(doc, "sourceDate");
        foreach (var d in doc["decks"]?.AsArray() ?? [])
        {
            var check = new CheckBox { Content = S(d, "name"), IsChecked = true }; var weight = new NumericUpDown { Minimum = 0, Maximum = 1000000, Value = d?["metaShare"]?.GetValue<decimal>() ?? 1, Width = 100, Increment = 1 };
            opponentChoices.Add(new(d!.DeepClone(), check, weight)); var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,110") }; grid.Children.Add(check); Grid.SetColumn(weight, 1); grid.Children.Add(weight); opponentRows.Children.Add(grid);
        }
    }
    async Task Validate()
    {
        var result = await Call("validate", new { decklist = deck.Text ?? "", format = FormatId }); bool valid = result?["valid"]?.GetValue<bool>() == true;
        validation.Text = valid ? "Deck validated. The cards, deck size and format requirements passed." : string.Join("\n", result?["errors"]?.AsArray().Select(e => S(e, "message")) ?? []);
        validation.Foreground = valid ? Brushes.LightGreen : Brushes.LightSalmon;
    }
    async Task StartRun()
    {
        if (pool.SelectedItem is not Row selected) throw new InvalidOperationException("Select an opponent pool first");
        var chosen = opponentChoices.Where(c => c.Selected.IsChecked == true).ToList(); if (chosen.Count == 0) throw new InvalidOperationException("Select at least one opponent");
        string mode = distribution.SelectedIndex switch { 1 => "meta", 2 => "custom", _ => "equal" };
        var selection = new JsonObject { ["mode"] = mode, ["opponentIds"] = new JsonArray(chosen.Select(c => JsonValue.Create(S(c.Deck, "id"))).ToArray()), ["allowRepeatedLists"] = repeated.IsChecked == true };
        if (mode == "custom") { var weights = new JsonObject(); foreach (var c in chosen) weights[S(c.Deck, "id")] = c.Weight.Value ?? 0; selection["weights"] = weights; }
        if (pods.Count > 0) selection["pods"] = new JsonArray(pods.Select(p => (JsonNode)new JsonObject { ["opponentIds"] = new JsonArray(p.Ids.Select(i => JsonValue.Create(i)).ToArray()), ["weight"] = p.Weight }).ToArray());
        var job = await Call("create", new { name = name.Text ?? "My deck", format = FormatId, decklist = deck.Text ?? "", snapshotId = S(selected.Data, "id"), games = Whole(games, "Games / matches"), seed = Whole(seed, "Seed"), clockSeconds = Whole(clock, "Game time limit"), gameMode = gameMode.SelectedItem?.ToString() ?? "BO1", maxMatchGames = Whole(matchLimit, "Match game limit"), sideboardMode = sideboard.IsChecked == true ? "forge" : "none", selection });
        message.Text = "Analysis queued. You can start another while capacity is available."; await Refresh(); await LoadResults(S(job, "id"));
    }
    async Task AddPod()
    {
        if (FormatId is not ("commander" or "cedh")) throw new InvalidOperationException("Explicit three-opponent pods are for four-player formats");
        var choices = opponentChoices.Select(c => new Row(c.Deck, S(c.Deck, "name"))).ToList(); if (choices.Count == 0) throw new InvalidOperationException("Choose a pool first");
        var seats = Enumerable.Range(0, 3).Select(i => new ComboBox { ItemsSource = choices, SelectedIndex = i % choices.Count }).ToArray(); var weight = new NumericUpDown { Minimum = 1, Maximum = 1000000, Value = 1 };
        var window = Child("Plan a pod", 540, 430); var content = Stack(Field("Opponent seat 2", seats[0]), Field("Opponent seat 3", seats[1]), Field("Opponent seat 4", seats[2]), Field("Pod weight", weight));
        content.Children.Add(Button("Add pod", () => { var ids = seats.Select(s => S(((Row)s.SelectedItem!).Data, "id")).ToArray(); var pod = new PodChoice(ids, string.Join(" / ", seats.Select(s => s.SelectedItem!.ToString())), weight.Value ?? 1); pods.Add(pod); var remove = Button("Remove", () => { pods.Remove(pod); RenderPods(); return Task.CompletedTask; }); podRows.Children.Add(RowPanel(Text(pod.Label), remove)); window.Close(); return Task.CompletedTask; })); window.Content = new ScrollViewer { Content = content, Margin = new Thickness(20) }; await window.ShowDialog(this);
    }
    void RenderPods() { podRows.Children.Clear(); foreach (var pod in pods) podRows.Children.Add(RowPanel(Text(pod.Label), Button("Remove", () => { pods.Remove(pod); RenderPods(); return Task.CompletedTask; }))); }
    static int Whole(NumericUpDown field, string name) { decimal value = field.Value ?? 0; if (decimal.Truncate(value) != value) throw new InvalidOperationException(name + " must be a whole number"); return (int)value; }
    Task LoadExample() { if (pool.SelectedItem is not Row row || row.Data["decks"]?.AsArray().FirstOrDefault() is not { } example) throw new InvalidOperationException("Complete setup and select a pool first"); deck.Text = S(example,"decklist"); name.Text = "Example · " + ((FormatChoice)format.SelectedItem!).Name; return Task.CompletedTask; }
    async Task OpenDeck() { var file = await Pick("Open decklist", ["*.txt", "*.dck", "*.dek"]); if (file is null) return; deck.Text = await ReadFile(file, 32768); name.Text = Path.GetFileNameWithoutExtension(file.Name); }
    async Task ImportLink() { var imported = await Call("importDeck", new { url = link.Text ?? "" }); deck.Text = S(imported, "decklist"); if (S(imported, "name").Length > 0) name.Text = S(imported, "name"); message.Text = "Deck imported. Validate it for the selected format."; }
    async Task RefreshMeta() { message.Text = "Refreshing sourced decks. Source-request spacing is respected; this can take several minutes."; await Call("refreshMeta", new { format = FormatId }); await LoadPools(); message.Text = "Saved a new immutable daily opponent pool."; }
    async Task ImportPool() { var file = await Pick("Import an opponent pool", ["*.json", "*.csv"]); if (file is null) return; await Call("importPool", new { text = await ReadFile(file, 5000000), csv = file.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase), format = FormatId, name = Path.GetFileNameWithoutExtension(file.Name), source = "Local file: " + file.Name }); await LoadPools(); }
    async Task ShowPoolDecks() { if (pool.SelectedItem is Row row) await DeckWindow("Opponent pool · " + S(row.Data, "name"), row.Data["decks"]?.AsArray().Select(d => (S(d, "name"), S(d, "decklist"))).ToArray() ?? []); }
    async Task OpenSelectedRun() { if (queue.SelectedItem is Row row) await LoadResults(S(row.Data, "id")); }
    async Task CancelSelected() { if (queue.SelectedItem is Row row) { await Call("cancel", new { id = S(row.Data, "id") }); await Refresh(); } }
    async Task RetrySelected() { if (queue.SelectedItem is Row row) await Retry(S(row.Data, "id")); }
    async Task RetryResult() { if (selectedJob is { } id) await Retry(id); }
    async Task Retry(string id)
    {
        var job = await Call("job", new { id }); bool canResume = S(job, "state") is "FAILED" or "CANCELLED"; var method = new ComboBox { ItemsSource = canResume ? new[] { "Resume unfinished games", "Start a new run" } : new[] { "Start a new run" }, SelectedIndex = 0 };
        int original = N(job?["input"], "clockSeconds"); var seconds = new NumericUpDown { Minimum = 5, Maximum = 300, Increment = 1, Value = N(job, "timeouts") > 0 ? 300 : original, IsEnabled = !canResume }; method.SelectionChanged += (_, _) => seconds.IsEnabled = !canResume || method.SelectedIndex == 1;
        var error = Text(""); var window = Child("Retry with settings", 570, 440); var content = Stack(Text(S(job?["input"], "name"), 20), Field("Retry method", method), Text("Resume keeps completed checkpoints and the original clock. A new run replays the saved plan and preserves the earlier results and histories."), Field("Game time limit (5–300 seconds)", seconds), error);
        var launch = new Button { Content = "Start", HorizontalAlignment = HorizontalAlignment.Left }; launch.Click += async (_, _) => { launch.IsEnabled = false; try { bool fresh = !canResume || method.SelectedIndex == 1; var retry = await Call("retry", fresh ? new { id, mode = "new", clockSeconds = Whole(seconds, "Game time limit") } : (object)new { id, mode = "resume" }); window.Close(); await LoadResults(S(retry, "id")); } catch (Exception e) { error.Text = e.Message; } finally { launch.IsEnabled = true; } }; content.Children.Add(launch); window.Content = new ScrollViewer { Content = content, Margin = new Thickness(20) }; await window.ShowDialog(this);
    }
    async Task LoadResults(string? id, bool select = true)
    {
        if (id is null) return; if (selectedJob != id) { runPage = 0; observationPage = 0; runs.ItemsSource = null; observations.ItemsSource = null; results = null; summary.Text = "Loading saved results…"; } selectedJob = id;
        var data = await Call("results", new { id }); if (selectedJob != id) return; results = data;
        var job = data?["job"]; resultTitle.Text = $"{S(job?["input"], "name")} · {S(job, "state")} · {S(job?["input"], "clockSeconds")} s/game";
        var s = data?["summary"]; summary.Text = $"Game win rate: {Percent(s?["winRate"])}   ·   {S(s, "wins")} wins / {S(s, "losses")} losses / {S(s, "draws")} draws\n95% interval: {Percent(s?["confidence95"]?[0])}–{Percent(s?["confidence95"]?[1])}   ·   {S(s, "games")} valid games   ·   {S(s, "timeouts")} timeouts   ·   {S(s, "errors")} engine errors\nAverage turns: {S(s, "averageTurns")}   ·   Average placement: {S(s, "averagePlacement")}";
        summary.Text += $"\nOn the play: {Percent(s?["onPlay"]?["winRate"])} · On the draw: {Percent(s?["onDraw"]?["winRate"])}";
        if (s?["commanderTiming"] is { } timing) summary.Text += $"\nCommander cast in {S(timing, "castGames")} games; not cast in {S(timing, "notCastGames")} · average first cast on player turn {S(timing, "averageFirstCastPlayerTurn")}";
        if (s?["lowSample"]?.GetValue<bool>() == true) summary.Text += "\nSmall sample — treat the rate and interval with caution.";
        if (data?["matchSummary"] is { } match) summary.Text += $"\nMatch win rate: {Percent(match["winRate"])} · {S(match, "matches")} completed matches";
        matchupPanel.Children.Clear();
        if (job?["config"]?["retryOf"] is { } parent) matchupPanel.Children.Add(Button("Open the previous run", () => LoadResults(parent.ToString())));
        foreach (var plan in data?["matchups"]?.AsArray() ?? []) { var p = plan!; matchupPanel.Children.Add(RowPanel(Text($"{S(p, "name")} · {Percent(p["summary"]?["winRate"])} · {S(p["summary"], "games")} valid games"), Button("Opponent decklists", () => DeckWindow(S(p, "name"), p["opponents"]!.AsArray().Select((o, i) => ($"Seat {i + 2}: {S(o, "name")}", S(o, "decklist"))).ToArray())))); }
        await LoadRuns(); await LoadObservations(); if (select) tabs.SelectedItem = resultsTab;
    }
    async Task LoadRuns() { if (selectedJob is not { } id) return; var values = await Call("runs", new { id, offset = runPage * 100, limit = 100 }); if (selectedJob != id) return; var rows = values?.AsArray().Select(r => new Row(r!.DeepClone(), $"{PlanName(S(r, "plan_key"))} · Unit {N(r, "unit_index") + 1} · {(r?["result"] is { } result ? Outcome(result) : S(r, "state"))}")).ToList() ?? []; if (rows.Count == 0 && runPage > 0) { runPage--; return; } runs.ItemsSource = rows; }
    async Task LoadObservations() { if (selectedJob is not { } id) return; var values = await Call("observations", new { id, offset = observationPage * 100 }); if (selectedJob != id) return; observations.ItemsSource = values?.AsArray().Select(o => new Row(o!.DeepClone(), $"{PlanName(S(o, "plan_key"))} · Match {N(o, "unit_index") + 1}, game {N(o?["result"], "index") + 1} · Attempt {S(o?["review"], "number")}/{S(o?["review"], "total")} · {S(o?["review"], "status")} · {Outcome(o?["result"])}")).ToList() ?? []; }
    JsonNode? Plan(string key) => results?["matchups"]?.AsArray().FirstOrDefault(p => S(p, "key") == key);
    string PlanName(string key) => S(Plan(key), "name");
    async Task OpenRunDetails() { if (runs.SelectedItem is not Row row) return; var result = row.Data["result"]; if (result is null) { message.Text = S(row.Data, "error").Length > 0 ? S(row.Data, "error") : "This unit has not finished."; return; } await GameWindow(result, Plan(S(row.Data, "plan_key")), null); }
    async Task OpenObservation() { if (observations.SelectedItem is Row row) await GameWindow(row.Data["result"]!, Plan(S(row.Data, "plan_key")), row.Data["review"]); }
    async Task ShowYourDeck() { if (results?["job"]?["deck"] is { } d) await DeckWindow("Your registered deck", [(S(d, "name"), S(d, "decklist"))]); }
    static string Outcome(JsonNode? game) => S(game, "termination") switch { "normal" => N(game, "winner") == 0 ? "Win" : "Loss", "rule_draw" => "Draw", "timeout" => "Time limit reached", "cancelled" => "Cancelled", "engine_error" => "Engine problem", "game_limit" => "Match game limit reached", _ => "Unfinished" };
    string Player(int seat, JsonNode? plan) => seat == 0 ? "Your deck (seat 1)" : $"{S(plan?["opponents"]?[seat - 1], "name")} (seat {seat + 1})";
    async Task GameWindow(JsonNode result, JsonNode? plan, JsonNode? review)
    {
        if (selectedJob is not { } id) return; var window = Child("Game details · " + PlanName(S(plan, "key")), 1000, 780); var panel = Stack(Text(Outcome(result), 22));
        if (review is not null) panel.Children.Add(Text($"Attempt {S(review, "number")} of {S(review, "total")} · {S(review, "status")}\nEarlier or unfinished attempts remain history and are excluded from finalized results."));
        foreach (var game in S(result, "unit") == "match" ? result["games"]!.AsArray().Select(g => g!) : new[] { result })
        {
            panel.Children.Add(Text($"Game {N(game, "index") + 1}: {Outcome(game)} · {S(game, "turns")} player turns · {S(game, "durationMs")} ms", 18)); panel.Children.Add(Text("First to play: " + (game["startingPlayer"] is null ? "Not recorded" : Player(N(game, "startingPlayer"), plan))));
            if (game["startingLife"] is { } lives) panel.Children.Add(Text("Starting life by seat: " + string.Join(" / ", lives.AsArray().Select(l => l!.ToString()))));
            foreach (var elimination in game["eliminations"]?.AsArray() ?? []) foreach (var seat in elimination?["players"]?.AsArray() ?? []) panel.Children.Add(Text($"{Player(seat!.GetValue<int>(), plan)} finished in place {S(elimination, "placement")}: {S(elimination?["reasons"], seat.ToString())}"));
            if (game["sideboardChanges"] is null) panel.Children.Add(Text("Sideboard changes were not recorded."));
            else if (game["sideboardChanges"]!.AsArray().All(c => c?["added"]?.AsArray().Count == 0 && c?["removed"]?.AsArray().Count == 0)) panel.Children.Add(Text("No sideboard changes were recorded."));
            foreach (var change in game["sideboardChanges"]?.AsArray() ?? []) { string Describe(string key) => string.Join(", ", change?[key]?.AsArray().Select(c => S(c, "quantity") + " × " + S(c, "name")) ?? []); if (Describe("added").Length + Describe("removed").Length > 0) panel.Children.Add(Text($"{Player(N(change, "player"), plan)} sideboard: in {Describe("added")}; out {Describe("removed")}")); }
            foreach (var cast in game["commanderCasts"]?.AsArray() ?? []) panel.Children.Add(Text($"{Player(N(cast, "player"), plan)} cast {S(cast, "card")} on their turn {S(cast, "playerTurn")}."));
            foreach (var choice in game["companionSelections"]?.AsArray() ?? []) if (choice?["declared"] is not null) panel.Children.Add(Text($"{Player(N(choice, "player"), plan)} companion: declared {S(choice, "declared")}; selected {(choice?["selected"] is null ? "none" : S(choice, "selected"))}"));
            if (game["actionHistory"] is not { } history) { panel.Children.Add(Text("Action history was not recorded for this game.")); continue; }
            if (history["complete"]?.GetValue<bool>() != true) panel.Children.Add(Text("Partial history: the game stopped early or some actions could not be recorded."));
            var actions = new ListBox { MaxHeight = 360, MinHeight = 120, ItemTemplate = new FuncDataTemplate<string>((value, _) => Text(value ?? "")) }; ScrollViewer.SetHorizontalScrollBarVisibility(actions, Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled); var phase = new CheckBox { Content = "Show phase and mana details" }; var loaded = new List<JsonNode>(); int? offset = 0; int previousTurn = -1;
            void RenderActions() { previousTurn = -1; var rows = new List<string>(); foreach (var entry in loaded) { int turn = N(entry, "turn"); if (turn != previousTurn) { rows.Add(turn == 0 ? "PREGAME" : $"TURN {turn} · {(entry["activePlayer"] is null ? "" : Player(N(entry, "activePlayer"), plan))}"); previousTurn = turn; } string kind = S(entry, "kind"); if (kind == "TURN" || (phase.IsChecked != true && kind is "PHASE" or "MANA")) continue; string text = System.Text.RegularExpressions.Regex.Replace(S(entry, "text"), @"Ai\(\d+\)-player-(\d+)|\bplayer-(\d+)\b", m => Player(int.Parse(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value, CultureInfo.InvariantCulture), plan)); rows.Add(kind.Replace('_', ' ').ToLowerInvariant() + " · " + text); } actions.ItemsSource = rows; }
            phase.IsCheckedChanged += (_, _) => RenderActions();
            var load = new Button { Content = "View action history", HorizontalAlignment = HorizontalAlignment.Left }; var historyError = Text("");
            load.Click += async (_, _) => { if (offset is null) return; load.IsEnabled = false; historyError.Text = ""; try { var page = await Call("actions", new { jobId = id, historyId = S(history, "id"), offset }); foreach (var entry in page?["entries"]?.AsArray() ?? []) loaded.Add(entry!.DeepClone()); offset = page?["nextOffset"]?.GetValue<int>(); RenderActions(); load.Content = offset is null ? "All saved entries loaded" : "Load more actions"; if (loaded.Count == 0) historyError.Text = "No action entries were recorded before the game stopped."; } catch (Exception e) { historyError.Text = e.Message + " — retry loading."; } finally { load.IsEnabled = offset is not null; } };
            panel.Children.Add(Stack(phase, load, historyError, actions));
        }
        window.Content = new ScrollViewer { Content = panel, Margin = new Thickness(20) }; await window.ShowDialog(this);
    }
    async Task DeckWindow(string title, (string Title, string Deck)[] decks)
    {
        var window = Child(title, 850, 700); var pages = new TabControl(); foreach (var item in decks) { var editor = new TextBox { Text = item.Deck, IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 430, FontFamily = new FontFamily("monospace") }; var copy = Button("Copy decklist", async () => { if (Clipboard is { } clipboard) await clipboard.SetValueAsync(DataFormat.Text, item.Deck); }); pages.Items.Add(Tab(item.Title, Stack(Text("Registered starting list. In-game sideboard changes appear in game details."), copy, editor))); } window.Content = pages; await window.ShowDialog(this);
    }
    async Task ExportResults()
    {
        if (results is null) return; var file = await StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions { Title = "Export saved results", SuggestedFileName = "magictester-results.json", FileTypeChoices = [new("JSON") { Patterns = ["*.json"] }, new("CSV") { Patterns = ["*.csv"] }] }); if (file is null) return;
        string text; if (file.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) { static string Quote(string s) => "\"" + s.Replace("\"", "\"\"") + "\""; var csv = new StringBuilder("opponent,games,wins,losses,draws,win_rate\n"); foreach (var p in results["matchups"]!.AsArray()) { var s = p!["summary"]; csv.AppendLine(string.Join(',', Quote(S(p, "name")), S(s, "games"), S(s, "wins"), S(s, "losses"), S(s, "draws"), S(s, "winRate"))); } text = csv.ToString(); } else text = results.ToJsonString(new() { WriteIndented = true }); await using var stream = await file.OpenWriteAsync(); using var writer = new StreamWriter(stream); await writer.WriteAsync(text); message.Text = "Export saved.";
    }
    async Task SetupEngine() => await SetupEngine(false);
    async Task SetupEngine(bool refreshCards) { setupProgress.Text = "Preparing engine setup…"; await Call("setup", new { refreshCards }); await Refresh(); await LoadPools(); message.Text = "Engine and card data are ready."; }
    Task OpenDataFolder() { if (worker is not null) Process.Start(new ProcessStartInfo { FileName = worker.DataDirectory, UseShellExecute = true }); return Task.CompletedTask; }
    async Task<IStorageFile?> Pick(string title, string[] patterns) => (await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions { Title = title, AllowMultiple = false, FileTypeFilter = [new("Supported files") { Patterns = patterns }] })).FirstOrDefault();
    static async Task<string> ReadFile(IStorageFile file, int max) { await using var stream = await file.OpenReadAsync(); if (stream.CanSeek && stream.Length > max) throw new IOException("File exceeds the supported size limit"); using var reader = new StreamReader(stream); string text = await reader.ReadToEndAsync(); if (Encoding.UTF8.GetByteCount(text) > max) throw new IOException("File exceeds the supported size limit"); return text; }
    Window Child(string title, double width, double height) => new() { Title = title, Width = width, Height = height, MinWidth = 400, MinHeight = 280, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Background, Foreground = Foreground, FontFamily = FontFamily };
    async void OnClosing(object? sender, WindowClosingEventArgs args) { if (closing) return; args.Cancel = true; closing = true; IsEnabled = false; timer?.Stop(); try { if (worker is not null) await worker.DisposeAsync(); } finally { instanceLock?.Dispose(); Close(); } }
}

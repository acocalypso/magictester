using System.Globalization;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace MagicTester.Desktop;

public sealed class SetupAssistant : UserControl
{
    readonly TextBlock heading = Label("Welcome to MagicTester", 26), introduction = Label("Set up the engine once, then test decks locally. The assistant downloads Forge and card data, verifies the files, prepares the engine, and plays validation games. Allow 4–6 GB of disk space and an internet connection."),
        step = Label("Ready to begin", 18), detail = Label(""), transfer = Label(""), location = Label(""), outcome = Label("");
    readonly ProgressBar progress = new() { Minimum = 0, Maximum = 100, Height = 10, Foreground = new SolidColorBrush(Color.Parse("#A9B7C6")) };
    readonly StackPanel steps = new() { Spacing = 7 };
    readonly Button begin = new() { Content = "Download & set up", Padding = new Thickness(16, 10) },
        cancel = new() { Content = "Cancel setup", IsVisible = false },
        use = new() { Content = "Start testing a deck", IsVisible = false },
        refresh = new() { Content = "Refresh card data", IsVisible = false },
        later = new() { Content = "Set up later" };
    JsonNode? state;
    bool installed, requestRunning, cancelling;
    public string Status => state?["status"]?.ToString() ?? "idle";
    public bool CanStart => begin.IsEnabled;
    public bool IsProgressIndeterminate => progress.IsIndeterminate;
    public double StageProgress => progress.Value;
    public string ProgressDescription => transfer.Text ?? "";
    public SetupAssistant(Func<bool, Task> setup, Func<Task> stop, Func<Task> continueToDecks, Action defer)
    {
        Name = "FirstTimeSetupAssistant";
        var buttons = new WrapPanel { Orientation = Orientation.Horizontal, Children = { use, begin, cancel, refresh, later } };
        foreach (var button in new[] { begin, use, cancel, refresh, later }) button.Margin = new Thickness(0, 0, 10, 8);
        begin.Click += async (_, _) => await setup(false);
        refresh.Click += async (_, _) => await setup(true);
        cancel.Click += async (_, _) => { cancelling = true; Render(); try { await stop(); } finally { cancelling = false; Render(); } };
        use.Click += async (_, _) => await continueToDecks();
        later.Click += (_, _) => defer();
        Content = new Border { Background = new SolidColorBrush(Color.Parse("#101214")), BorderBrush = new SolidColorBrush(Color.Parse("#383C41")), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(24), MaxWidth = 960, HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = new StackPanel { Spacing = 14, Children = { heading, introduction, location, step, progress, transfer, detail, buttons, steps, outcome } } };
        Apply(JsonNode.Parse("{\"status\":\"idle\"}"));
    }
    static TextBlock Label(string text, double size = 14) => new() { Text = text, FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = new SolidColorBrush(Color.Parse("#D5D8DD")) };
    static string S(JsonNode? node, string key) => node?[key]?.ToString() ?? "";
    static double? Number(JsonNode? node, string key) => node?[key] is JsonValue value && double.TryParse(value.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ? number : null;
    static string MiB(double bytes) => (bytes / (1024 * 1024)).ToString("N1", CultureInfo.CurrentCulture) + " MiB";
    public void SetWorkspace(string path, bool ready) { installed = ready; location.Text = "Local data folder: " + path; Render(); }
    public void SetRequestRunning(bool value) { requestRunning = value; Render(); }
    public void Begin() { state = state?.DeepClone() ?? new JsonObject(); state["status"] = "running"; state["stage"] = "release"; state["stageIndex"] = 0; state["fraction"] = null; foreach (string key in new[] { "bytes", "totalBytes", "bytesPerSecond", "completed", "total" }) state[key] = null; state["message"] = "Checking the latest stable engine…"; if (state["stages"] is JsonArray stages) foreach (var item in stages) if (item is not null) item["status"] = S(item, "id") == "release" ? "running" : "pending"; Render(); }
    public void Apply(JsonNode? value) { if (value is not null) { double generation = Number(value, "generation") ?? 0, previous = Number(state, "generation") ?? 0; if (generation < previous || (generation == previous && (Number(value, "revision") ?? 0) < (Number(state, "revision") ?? 0))) return; state = value.DeepClone(); } Render(); }
    public void Fail(string error, bool cancelled = false) { state = state?.DeepClone() ?? new JsonObject(); state["status"] = cancelled ? "cancelled" : "error"; state["message"] = error; Render(); }
    public void MarkReady() { installed = true; state = state?.DeepClone() ?? new JsonObject(); state["status"] = "complete"; state["message"] = "Your local engine is ready. You can now import a deck and start an analysis."; Render(); }
    void Render()
    {
        string status = Status;
        bool running = requestRunning || status == "running", complete = installed && !running && (status is "complete" or "idle");
        heading.Text = status == "error" ? "Setup needs attention" : status == "cancelled" ? "Setup paused" : running ? "Setting up your local engine" : complete ? "Your engine is ready" : "Welcome to MagicTester";
        introduction.IsVisible = !running && !complete;
        int index = (int)(Number(state, "stageIndex") ?? 0), count = (int)(Number(state, "stageCount") ?? 9);
        step.Text = running ? $"Step {index + 1} of {count} · {StageTitle()}" : complete ? "Setup complete" : status is "error" or "cancelled" ? "Retry when you are ready" : "One setup. No Docker or runtime installation needed.";
        detail.Text = cancelling ? "Cancelling safely. Waiting for the current process to stop…" : S(state, "message");
        progress.IsVisible = running || complete;
        double? fraction = Number(state, "fraction");
        progress.IsIndeterminate = running && fraction is null;
        progress.Value = complete ? 100 : Math.Clamp((fraction ?? 0) * 100, 0, 100);
        double? bytes = Number(state, "bytes"), total = Number(state, "totalBytes"), speed = Number(state, "bytesPerSecond");
        transfer.Text = bytes is not null ? (S(state, "stage") == "extract" ? "Archive processed: " : "Received: ") + MiB(bytes.Value) + (total > 0 ? " of " + MiB(total.Value) : " · total size not supplied") + (fraction is not null ? $" · {fraction.Value:P0}" : "") + (speed > 0 ? " · " + MiB(speed.Value) + "/s" : "")
            : Number(state, "total") is double checks && checks > 0 ? $"{Number(state, "completed") ?? 0:0} of {checks:0} engine checks completed"
            : running ? "This step does not report a byte total. The assistant will advance when it finishes." : "";
        transfer.IsVisible = running && transfer.Text.Length > 0;
        steps.Children.Clear();
        if (state?["stages"] is JsonArray stages && status != "idle")
            foreach (var item in stages) { string s = S(item, "status"); bool active = S(item, "id") == S(state, "stage"); string marker = s == "complete" || complete ? "✓" : active && status == "error" ? "!" : active ? "●" : "○"; var row = Label(marker + "  " + S(item, "title")); row.Opacity = s == "complete" || active || complete ? 1 : 0.5; steps.Children.Add(row); }
        outcome.Text = status == "error" ? "Verified card data is kept for retry. An incomplete engine download is discarded. Your existing decks and results are preserved." : status == "cancelled" ? "You can restart setup at any time. Existing decks and results are preserved." : complete ? S(state, "message") : "";
        outcome.Foreground = new SolidColorBrush(Color.Parse(status == "error" ? "#E8A5A5" : "#D5D8DD"));
        begin.IsEnabled = !running;
        begin.Content = status is "error" or "cancelled" ? "Retry setup" : installed ? "Check for engine updates" : "Download & set up";
        begin.IsVisible = !running;
        cancel.IsVisible = running; cancel.IsEnabled = !cancelling && status == "running";
        use.IsVisible = complete; refresh.IsVisible = installed && !running; later.IsVisible = !installed && !running;
    }
    string StageTitle() => (state?["stages"] as JsonArray)?.FirstOrDefault(s => S(s, "id") == S(state, "stage"))?["title"]?.ToString() ?? "Prepare the engine";
}

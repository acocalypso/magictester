using System.Text.Json.Nodes;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using MagicTester.Desktop;

static class SetupChecks
{
    public static void Run(Window window, string artifacts)
    {
        var assistant = window.GetVisualDescendants().OfType<SetupAssistant>().Single();
        var tabs = window.GetVisualDescendants().OfType<TabControl>().First();
        if ((tabs.SelectedItem as TabItem)?.Header?.ToString() != "Setup & information") throw new Exception("First launch did not open the setup assistant");
        var known = JsonNode.Parse("""
        {"status":"running","generation":1000,"revision":1,"stage":"download","stageIndex":1,"stageCount":9,"message":"Downloading the Forge engine…","bytes":1048576,"totalBytes":2097152,"bytesPerSecond":524288,"fraction":0.5,
        "stages":[{"id":"release","title":"Find the latest stable engine","status":"complete"},{"id":"download","title":"Download Forge","status":"running"},{"id":"verify","title":"Verify the engine download","status":"pending"},{"id":"extract","title":"Extract engine files","status":"pending"},{"id":"cards","title":"Download card data","status":"pending"},{"id":"metadata","title":"Prepare card compatibility data","status":"pending"},{"id":"bridge","title":"Prepare the simulation engine","status":"pending"},{"id":"validation","title":"Check rules and play validation games","status":"pending"},{"id":"ready","title":"Ready to test decks","status":"pending"}]}
        """)!;
        assistant.SetRequestRunning(true); assistant.Apply(known);
        if (assistant.CanStart || assistant.IsProgressIndeterminate || assistant.StageProgress != 50 || !assistant.ProgressDescription.Contains("MiB")) throw new Exception("Known-size download progress is not usable");
        Save(window, artifacts, "desktop-setup-progress.png");
        var unknown = known.DeepClone(); unknown["revision"] = 2; unknown["totalBytes"] = null; unknown["fraction"] = null;
        assistant.Apply(unknown);
        if (!assistant.IsProgressIndeterminate || !assistant.ProgressDescription.Contains("not supplied")) throw new Exception("Unknown-size download invented a percentage");
        assistant.Apply(known);
        if (!assistant.IsProgressIndeterminate) throw new Exception("Stale polling regressed setup progress");
        assistant.SetRequestRunning(false); assistant.Fail("The connection was interrupted. Retry setup to continue.");
        if (!assistant.CanStart || assistant.Status != "error") throw new Exception("Setup failure does not allow retry");
        Save(window, artifacts, "desktop-setup-retry.png");
        assistant.Begin();
        if (!assistant.IsProgressIndeterminate || assistant.ProgressDescription.Contains("MiB")) throw new Exception("Retry retained stale transfer numbers");
        assistant.MarkReady();
        if (assistant.Status != "complete" || assistant.StageProgress != 100) throw new Exception("Setup completion is not visible");
        Console.WriteLine("First-launch setup, measured/unknown progress, stale-event handling, retry and completion checks passed");
    }
    static void Save(Window window, string artifacts, string file)
    {
        Dispatcher.UIThread.RunJobs();
        using var frame = window.CaptureRenderedFrame() ?? throw new Exception("Setup view did not render");
        frame.Save(Path.Combine(artifacts, file), new PngBitmapEncoderOptions());
    }
}

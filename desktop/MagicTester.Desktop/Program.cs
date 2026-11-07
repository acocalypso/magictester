using Avalonia;
namespace MagicTester.Desktop;
internal static class Program
{
    [STAThread] public static int Main(string[] args)
    {
        if (args.FirstOrDefault() == "--extract-forge") return ForgeArchive.Run(args);
        if (args.Contains("--engine-check")) return WorkerCheck.RunEngineAsync().GetAwaiter().GetResult();
        if (args.Contains("--worker-check")) return WorkerCheck.RunAsync().GetAwaiter().GetResult();
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}

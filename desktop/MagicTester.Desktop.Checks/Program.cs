using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Threading;
using MagicTester.Desktop;
// Rendering checks must never start jobs or maintenance in the user's workspace.
string? ownedData = null;
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MAGICTESTER_DATA")))
{
    ownedData = Path.Combine(Path.GetTempPath(), "magictester-ui-" + Guid.NewGuid());
    Environment.SetEnvironmentVariable("MAGICTESTER_DATA", ownedData);
}
Environment.SetEnvironmentVariable("MAGICTESTER_AUTO_MAINTENANCE", "0");
ArchiveChecks.Run();
AppBuilder.Configure<App>().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).UseSkia().SetupWithoutStarting();
var window = new MainWindow(); window.Show();
for (int i = 0; i < 80; i++) { Dispatcher.UIThread.RunJobs(); Thread.Sleep(50); }
if (window.Content is null || window.Width < 800) throw new Exception("Native window did not initialize");
using (var frame = window.CaptureRenderedFrame())
{
    if (frame is null) throw new Exception("Native renderer did not produce a frame");
    string artifacts = Environment.GetEnvironmentVariable("DESKTOP_ARTIFACTS") ?? (Directory.Exists("desktop") ? "desktop/artifacts" : "artifacts"); Directory.CreateDirectory(artifacts); frame.Save(Path.Combine(artifacts, "desktop-ui.png"), new Avalonia.Media.Imaging.PngBitmapEncoderOptions());
}
string setupArtifacts = Environment.GetEnvironmentVariable("DESKTOP_ARTIFACTS") ?? (Directory.Exists("desktop") ? "desktop/artifacts" : "artifacts");
SetupChecks.Run(window, setupArtifacts);
window.Close();
for (int i = 0; i < 80; i++) { Dispatcher.UIThread.RunJobs(); Thread.Sleep(50); }
if (window.IsVisible) throw new Exception("Native window did not finish shutting down");
if (ownedData is not null && Directory.Exists(ownedData)) Directory.Delete(ownedData, true);
Console.WriteLine("Native Avalonia render and clean close passed");

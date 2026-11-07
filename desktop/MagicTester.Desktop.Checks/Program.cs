using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Threading;
using MagicTester.Desktop;
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
window.Close();
for (int i = 0; i < 80; i++) { Dispatcher.UIThread.RunJobs(); Thread.Sleep(50); }
Console.WriteLine("Native Avalonia render and clean close passed");

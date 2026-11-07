using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace MagicTester.Desktop;
// Long-lived private pipes; no localhost server and no webview.
public sealed class WorkerClient : IAsyncDisposable
{
    readonly Process process;
    readonly SemaphoreSlim writer = new(1, 1);
    readonly ConcurrentDictionary<long, TaskCompletionSource<JsonNode?>> pending = new();
    readonly Task reader;
    readonly Task stderr;
    long sequence;
    bool stopping;
    public event Action<string, JsonNode?>? Notification;
    public string DataDirectory { get; }
    public WorkerClient()
    {
        DataDirectory = Environment.GetEnvironmentVariable("MAGICTESTER_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MagicTester");
        Directory.CreateDirectory(DataDirectory);
        string home = AppContext.BaseDirectory;
        string? source = Environment.GetEnvironmentVariable("MAGICTESTER_ENGINE");
        string worker = source ?? Path.Combine(home, "engine", "worker.mjs");
        if (!File.Exists(worker)) throw new FileNotFoundException("The engine is missing. Build desktop/engine and set MAGICTESTER_ENGINE for development, or use the complete release package.", worker);
        string node = Environment.GetEnvironmentVariable("MAGICTESTER_NODE") ?? Path.Combine(home, "tools", "node", OperatingSystem.IsWindows() ? "node.exe" : "node");
        if (!File.Exists(node)) node = "node";
        var info = new ProcessStartInfo(node) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(worker)!, StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        info.ArgumentList.Add("--disable-warning=ExperimentalWarning"); info.ArgumentList.Add(worker);
        info.Environment["DATA_DIR"] = DataDirectory;
        info.Environment["FORGE_HOME"] = Path.Combine(DataDirectory, "forge");
        info.Environment["NODE_USE_ENV_PROXY"] = "1";
        if (System.Reflection.Assembly.GetEntryAssembly() == typeof(WorkerClient).Assembly)
        {
            info.Environment["MAGICTESTER_HOST"] = Environment.ProcessPath ?? throw new InvalidOperationException("Cannot locate the native application host");
            // dotnet EXECUTABLE.dll is supported as well as a published apphost.
            if (Path.GetFileNameWithoutExtension(Environment.ProcessPath).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                info.Environment["MAGICTESTER_HOST_ASSEMBLY"] = Path.Combine(AppContext.BaseDirectory, "MagicTester.dll");
            else info.Environment.Remove("MAGICTESTER_HOST_ASSEMBLY");
        }
        string java = Path.Combine(home, "tools", "java", "bin");
        if (Directory.Exists(java)) { info.Environment["PATH"] = java + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH"); info.Environment["JAVA_HOME"] = Path.GetDirectoryName(java); }
        process = Process.Start(info) ?? throw new InvalidOperationException("Could not start the local engine");
        reader = ReadAsync(); stderr = DrainErrorsAsync();
    }
    async Task ReadAsync()
    {
        Exception failure = new IOException("The local engine stopped");
        try
        {
            while (await process.StandardOutput.ReadLineAsync() is { } line)
            {
                if (line.Length > 16 * 1024 * 1024) throw new IOException("Engine response exceeds its size limit");
                var message = JsonNode.Parse(line)?.AsObject() ?? throw new IOException("Invalid engine response");
                if (message["id"] is JsonValue idValue && idValue.TryGetValue<long>(out long id) && pending.TryRemove(id, out var completion))
                {
                    if (message["error"] is { } error) completion.TrySetException(new InvalidOperationException(error["message"]?.ToString() ?? "Engine operation failed"));
                    else completion.TrySetResult(message["result"]?.DeepClone());
                }
                else if (message["event"] is { } name) Notification?.Invoke(name.ToString(), message["payload"]?.DeepClone());
            }
        }
        catch (Exception error) { failure = error; }
        finally { foreach (var pair in pending) if (pending.TryRemove(pair.Key, out var completion)) completion.TrySetException(failure); if (!stopping) Notification?.Invoke("disconnected", JsonValue.Create(failure.Message)); }
    }
    async Task DrainErrorsAsync()
    {
        string log = Path.Combine(DataDirectory, "desktop-engine.log");
        while (await process.StandardError.ReadLineAsync() is { } line)
        {
            try { if (File.Exists(log) && new FileInfo(log).Length > 4 * 1024 * 1024) File.Move(log, log + ".previous", true); await File.AppendAllTextAsync(log, line[..Math.Min(line.Length, 6000)] + Environment.NewLine); } catch (IOException) { }
        }
    }
    public async Task<JsonNode?> CallAsync(string method, object? parameters = null, CancellationToken token = default)
    {
        if (process.HasExited) throw new IOException("The local engine has stopped. Restart MagicTester to recover unfinished work.");
        long id = Interlocked.Increment(ref sequence);
        var completion = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        using var registration = token.Register(() => { if (pending.TryRemove(id, out var entry)) entry.TrySetCanceled(token); });
        try
        {
            await writer.WaitAsync(token);
            try { await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { id, method, @params = parameters ?? new { } })); await process.StandardInput.FlushAsync(token); }
            finally { writer.Release(); }
            return await completion.Task;
        }
        catch { pending.TryRemove(id, out _); throw; }
    }
    public async ValueTask DisposeAsync()
    {
        if (stopping) return; stopping = true;
        try { using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15)); await CallAsync("shutdown", token: timeout.Token); await process.WaitForExitAsync(timeout.Token); }
        catch (Exception) { try { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); } catch (InvalidOperationException) { } }
        await Task.WhenAll(reader, stderr); process.Dispose(); writer.Dispose();
    }
}
internal static class WorkerCheck
{
    public static async Task<int> RunEngineAsync()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        await using var worker = new WorkerClient();
        worker.Notification += (kind, payload) => { if (kind is "setup" or "warning") Console.WriteLine(payload?["message"]?.ToString()); };
        Console.WriteLine("Checking bundled Java, verified Forge download and native contracts…");
        await worker.CallAsync("setup");
        var pools = (await worker.CallAsync("snapshots", new { format = "pauper" }))!.AsArray();
        var pool = pools.First(p => p?["reference"]?.GetValue<bool>() == true)!;
        var job = await worker.CallAsync("create", new { name = "Packaged engine acceptance", format = "pauper", snapshotId = pool["id"]!.ToString(), decklist = pool["decks"]![0]!["decklist"]!.ToString(), games = 2, seed = 12345, clockSeconds = 300, gameMode = "BO1", sideboardMode = "none" });
        string id = job!["id"]!.ToString();
        async Task<JsonNode> Until(string jobId, Func<JsonNode, bool> condition)
        {
            for (int i = 0; i < 600; i++) { var current = (await worker.CallAsync("job", new { id = jobId }))!; if (current["state"]?.ToString() == "FAILED") throw new IOException(current["error"]?.ToString()); if (condition(current)) return current; if (i % 30 == 0) Console.WriteLine($"Acceptance run {jobId}: {current["state"]}; resources: {(await worker.CallAsync("status"))?["resources"]}"); await Task.Delay(1000); }
            throw new TimeoutException("Packaged engine acceptance timed out");
        }
        await Until(id, j => j["state"]?.ToString() == "COMPLETED");
        var runs = (await worker.CallAsync("runs", new { id }))!.AsArray();
        if (runs.Count != 2 || runs.Any(r => r?["result"]?["termination"]?.ToString() != "normal" || r["result"]?["actionHistory"] is null)) throw new IOException("Packaged engine did not save two real games with histories");
        var retry = await worker.CallAsync("retry", new { id, mode = "new", clockSeconds = 240 }); string retryId = retry!["id"]!.ToString();
        await Until(retryId, j => j["state"]?.ToString() == "RUNNING");
        await worker.CallAsync("cancel", new { id = retryId });
        bool resumed = false;
        for (int i = 0; i < 30; i++) { try { var value = await worker.CallAsync("retry", new { id = retryId, mode = "resume" }); if (value?["id"]?.ToString() != retryId) throw new IOException("Resume changed job identity"); resumed = true; break; } catch (InvalidOperationException) { await Task.Delay(500); } }
        if (!resumed) throw new IOException("Cancellation did not release the native process");
        await Until(retryId, j => j["state"]?.ToString() == "COMPLETED");
        Console.WriteLine("Packaged real-engine validation, SQLite results, history, process-tree cancellation and resume passed.");
        return 0;
    }
    public static async Task<int> RunAsync()
    {
        await using var worker = new WorkerClient();
        var status = await worker.CallAsync("status");
        if (status?["formats"]?.AsArray().Count != 9) throw new InvalidOperationException("Worker did not expose all nine formats");
        Console.WriteLine("Native client/private-worker handshake passed; SQLite opened; nine formats available.");
        return 0;
    }
}

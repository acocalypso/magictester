using System.Formats.Tar;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using SharpCompress.Compressors;
using SharpCompress.Compressors.BZip2;

namespace MagicTester.Desktop;

public static class ForgeArchive
{
    // Runs in a short-lived headless host process. The compressed archive and
    // decompressed tar are streamed; neither is buffered in memory in full.
    public static void Extract(string archive, string destination, Action<long, long>? report = null)
    {
        Directory.CreateDirectory(destination);
        using var source = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
        using var tracked = new ReadProgressStream(source, report);
        using var decoded = new BZip2Stream(tracked, CompressionMode.Decompress, true);
        // The .NET extractor rejects entries escaping the destination directory.
        TarFile.ExtractToDirectory(decoded, destination, overwriteFiles: true);
        tracked.ReportFinalRead();
    }

    public static int Run(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length != 3) throw new ArgumentException("Expected --extract-forge ARCHIVE DESTINATION");
            long total = new FileInfo(args[1]).Length;
            void Progress(long bytes, long size, bool complete = false) => Console.WriteLine(JsonSerializer.Serialize(new { @event = "extraction_progress", bytes, totalBytes = size, complete, message = "Extracting engine files…" }));
            Progress(0, total);
            Extract(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]), (bytes, size) => Progress(bytes, size));
            Progress(total, total, true);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Forge extraction failed: " + error.Message);
            return 1;
        }
    }

    sealed class ReadProgressStream(Stream input, Action<long, long>? report) : Stream
    {
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly long total = input.Length;
        long bytes, nextSample = 65536, lastReport;
        public void ReportFinalRead() => report?.Invoke(bytes, total);
        void Track(int count)
        {
            if (count <= 0 || report is null) return;
            bytes += count;
            if (bytes < nextSample && bytes != total) return;
            nextSample = bytes + 65536;
            long now = clock.ElapsedMilliseconds;
            if (now - lastReport < 250 && bytes != total) return;
            lastReport = now; report(bytes, total);
        }
        public override int Read(byte[] buffer, int offset, int count) { int n = input.Read(buffer, offset, count); Track(n); return n; }
        public override int Read(Span<byte> buffer) { int n = input.Read(buffer); Track(n); return n; }
        public override int ReadByte() { int value = input.ReadByte(); if (value >= 0) Track(1); return value; }
        public override bool CanRead => true;
        public override bool CanWrite => false;
        public override bool CanSeek => false;
        public override long Length => total;
        public override long Position { get => input.Position; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}

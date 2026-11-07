using System.Formats.Tar;
using System.Text;
using SharpCompress.Compressors;
using SharpCompress.Compressors.BZip2;
using MagicTester.Desktop;

static class ArchiveChecks
{
    public static void Run()
    {
        string temp = Path.Combine(Path.GetTempPath(), "magictester-archive-" + Guid.NewGuid());
        Directory.CreateDirectory(temp);
        try
        {
            string sample = Path.Combine(temp, "sample.tar.bz2"), output = Path.Combine(temp, "output");
            Make(sample, "res/Éowyn.txt");
            ForgeArchive.Extract(sample, output);
            if (File.ReadAllText(Path.Combine(output, "res", "Éowyn.txt")) != "Local card rules") throw new Exception("Archive extraction changed Unicode paths or file data");
            string malicious = Path.Combine(temp, "escape.tar.bz2");
            Make(malicious, "../escaped.txt");
            bool rejected = false;
            try { ForgeArchive.Extract(malicious, Path.Combine(temp, "safe")); } catch (IOException) { rejected = true; }
            if (!rejected || File.Exists(Path.Combine(temp, "escaped.txt"))) throw new Exception("Archive traversal was not rejected");
            string corrupt = Path.Combine(temp, "corrupt.tar.bz2"); File.WriteAllText(corrupt, "This is not an archive");
            rejected = false;
            try { ForgeArchive.Extract(corrupt, Path.Combine(temp, "corrupt")); } catch (Exception error) when (error is not OutOfMemoryException) { rejected = true; }
            if (!rejected) throw new Exception("Corrupt archive was accepted");
            Console.WriteLine("Native streaming extraction, Unicode paths, traversal rejection and corrupt-input checks passed");
        }
        finally { Directory.Delete(temp, true); }
    }
    static void Make(string archive, string name)
    {
        using var file = File.Create(archive);
        using var encoded = new BZip2Stream(file, CompressionMode.Compress, false);
        using var writer = new TarWriter(encoded, TarEntryFormat.Pax, leaveOpen: true);
        using var data = new MemoryStream(Encoding.UTF8.GetBytes("Local card rules"));
        writer.WriteEntry(new PaxTarEntry(TarEntryType.RegularFile, name) { DataStream = data });
    }
}

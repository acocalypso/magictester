using System.Formats.Tar;
using SharpCompress.Compressors;
using SharpCompress.Compressors.BZip2;

namespace MagicTester.Desktop;

public static class ForgeArchive
{
    // Runs in a short-lived headless host process. The compressed archive and
    // decompressed tar are streamed; neither is buffered in memory in full.
    public static void Extract(string archive, string destination)
    {
        Directory.CreateDirectory(destination);
        using var source = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
        using var decoded = new BZip2Stream(source, CompressionMode.Decompress, true);
        // The .NET extractor rejects entries escaping the destination directory.
        TarFile.ExtractToDirectory(decoded, destination, overwriteFiles: true);
    }

    public static int Run(string[] args)
    {
        try
        {
            if (args.Length != 3) throw new ArgumentException("Expected --extract-forge ARCHIVE DESTINATION");
            Extract(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Forge extraction failed: " + error.Message);
            return 1;
        }
    }
}

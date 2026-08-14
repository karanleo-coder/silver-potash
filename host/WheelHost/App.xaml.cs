using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace WheelHost;

public partial class App : Application
{
    private static readonly string CrashLogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WheelHost", "crash.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            ReportCrash(args.ExceptionObject as Exception, "AppDomain.UnhandledException");
        DispatcherUnhandledException += (_, args) =>
        {
            ReportCrash(args.Exception, "DispatcherUnhandledException");
            args.Handled = true;
            Shutdown(1);
        };

        base.OnStartup(e);

        try
        {
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
        }
        catch (Exception ex)
        {
            ReportCrash(ex, "OnStartup");
            Shutdown(1);
        }
    }

    private static void ReportCrash(Exception? ex, string source)
    {
        var text = $"[{DateTime.Now:O}] {source}\n{ex}\n\n";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CrashLogPath)!);
            File.AppendAllText(CrashLogPath, text);
        }
        catch
        {
            // best-effort — still show the message box below even if the log write fails
        }

        MessageBox.Show(
            $"WheelHost failed to start:\n\n{ex?.Message}\n\nFull details were written to:\n{CrashLogPath}",
            "WheelHost - Startup Error", MessageBoxButton.OK, MessageBoxImage.Error);
    }
}

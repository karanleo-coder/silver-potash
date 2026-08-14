namespace WheelHost.Models;

/// <summary>Persisted host settings, stored as JSON under %AppData%\WheelHost\settings.json.</summary>
public class AppSettings
{
    public int Port { get; set; } = 7890;
    public ControllerMapping Mapping { get; set; } = ControllerMapping.Default();
}

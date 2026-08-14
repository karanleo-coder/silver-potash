namespace WheelHost.Models;

/// <summary>Snapshot of the single currently-connected controller device, for UI display.</summary>
public record DeviceSession(string Name, DateTime ConnectedAtUtc);

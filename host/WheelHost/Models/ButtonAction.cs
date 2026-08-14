namespace WheelHost.Models;

/// <summary>Logical wheel input, decoupled from whatever on-screen slot the client mapped it to.</summary>
public enum ButtonAction
{
    Accelerate,
    Brake,
    GearUp,
    GearDown,
    Handbrake,
    Extra1,
    Extra2,
}

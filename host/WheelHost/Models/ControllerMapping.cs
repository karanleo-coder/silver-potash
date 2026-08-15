namespace WheelHost.Models;

/// <summary>Maps each logical <see cref="ButtonAction"/> to a physical element on the virtual Xbox 360 controller.</summary>
public class ControllerMapping
{
    public Dictionary<ButtonAction, Xbox360Element> Buttons { get; set; } = DefaultButtons();

    public static ControllerMapping Default() => new();

    private static Dictionary<ButtonAction, Xbox360Element> DefaultButtons() => new()
    {
        [ButtonAction.Accelerate] = Xbox360Element.RightTrigger,
        [ButtonAction.Brake] = Xbox360Element.LeftTrigger,
        [ButtonAction.GearUp] = Xbox360Element.RightShoulder,
        [ButtonAction.GearDown] = Xbox360Element.LeftShoulder,
        [ButtonAction.Handbrake] = Xbox360Element.A,
        [ButtonAction.Extra1] = Xbox360Element.X,
        [ButtonAction.Extra2] = Xbox360Element.Y,
    };

    public Xbox360Element Get(ButtonAction action) =>
        Buttons.TryGetValue(action, out var element) ? element : Xbox360Element.None;
}

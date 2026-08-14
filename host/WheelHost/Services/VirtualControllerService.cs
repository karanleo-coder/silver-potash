using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Exceptions;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;
using WheelHost.Models;

namespace WheelHost.Services;

/// <summary>Wraps a ViGEm virtual Xbox 360 controller: steering axis + mapped buttons/triggers.</summary>
public class VirtualControllerService : IDisposable
{
    private ViGEmClient? _client;
    private IXbox360Controller? _controller;
    private readonly HashSet<ButtonAction> _pressedActions = new();

    public bool IsConnected { get; private set; }
    public string? LastError { get; private set; }

    /// <summary>Raised after steering is applied, so the host UI can drive a live preview bar.</summary>
    public event Action<double>? SteeringChanged;

    /// <summary>Raised after a button state is applied, so the host UI can light up an indicator.</summary>
    public event Action<ButtonAction, bool>? ButtonChanged;

    public bool Connect()
    {
        try
        {
            _client = new ViGEmClient();
            _controller = _client.CreateXbox360Controller();
            _controller.Connect();
            IsConnected = true;
            LastError = null;
            return true;
        }
        catch (VigemBusNotFoundException)
        {
            LastError = "ViGEmBus driver not found. Install it from " +
                        "https://github.com/ViGEm/ViGEmBus/releases, then restart WheelHost.";
            IsConnected = false;
            return false;
        }
        catch (Exception ex)
        {
            LastError = $"Failed to create virtual controller: {ex.Message}";
            IsConnected = false;
            return false;
        }
    }

    public void SetSteering(double normalized)
    {
        if (_controller is null) return;
        var clamped = Math.Clamp(normalized, -1.0, 1.0);
        var value = (short)Math.Round(clamped * short.MaxValue);
        _controller.SetAxisValue(Xbox360Axis.LeftThumbX, value);
        SteeringChanged?.Invoke(clamped);
    }

    public void SetButton(ButtonAction action, bool pressed, ControllerMapping mapping)
    {
        if (_controller is null) return;

        ApplyElement(mapping.Get(action), pressed);

        if (pressed) _pressedActions.Add(action);
        else _pressedActions.Remove(action);

        ButtonChanged?.Invoke(action, pressed);
    }

    /// <summary>Centers steering and releases every currently-pressed button. Used on disconnect/watchdog timeout.</summary>
    public void ResetAll(ControllerMapping mapping)
    {
        if (_controller is null) return;

        SetSteering(0);
        foreach (var action in _pressedActions.ToList())
        {
            SetButton(action, false, mapping);
        }
    }

    private void ApplyElement(Xbox360Element element, bool pressed)
    {
        if (_controller is null) return;

        switch (element)
        {
            case Xbox360Element.LeftTrigger:
                _controller.SetSliderValue(Xbox360Slider.LeftTrigger, pressed ? byte.MaxValue : (byte)0);
                break;
            case Xbox360Element.RightTrigger:
                _controller.SetSliderValue(Xbox360Slider.RightTrigger, pressed ? byte.MaxValue : (byte)0);
                break;
            case Xbox360Element.A:
                _controller.SetButtonState(Xbox360Button.A, pressed);
                break;
            case Xbox360Element.B:
                _controller.SetButtonState(Xbox360Button.B, pressed);
                break;
            case Xbox360Element.X:
                _controller.SetButtonState(Xbox360Button.X, pressed);
                break;
            case Xbox360Element.Y:
                _controller.SetButtonState(Xbox360Button.Y, pressed);
                break;
            case Xbox360Element.LeftShoulder:
                _controller.SetButtonState(Xbox360Button.LeftShoulder, pressed);
                break;
            case Xbox360Element.RightShoulder:
                _controller.SetButtonState(Xbox360Button.RightShoulder, pressed);
                break;
            case Xbox360Element.Back:
                _controller.SetButtonState(Xbox360Button.Back, pressed);
                break;
            case Xbox360Element.Start:
                _controller.SetButtonState(Xbox360Button.Start, pressed);
                break;
            case Xbox360Element.LeftThumb:
                _controller.SetButtonState(Xbox360Button.LeftThumb, pressed);
                break;
            case Xbox360Element.RightThumb:
                _controller.SetButtonState(Xbox360Button.RightThumb, pressed);
                break;
            case Xbox360Element.DPadUp:
                _controller.SetButtonState(Xbox360Button.Up, pressed);
                break;
            case Xbox360Element.DPadDown:
                _controller.SetButtonState(Xbox360Button.Down, pressed);
                break;
            case Xbox360Element.DPadLeft:
                _controller.SetButtonState(Xbox360Button.Left, pressed);
                break;
            case Xbox360Element.DPadRight:
                _controller.SetButtonState(Xbox360Button.Right, pressed);
                break;
            case Xbox360Element.None:
                break;
        }
    }

    public void Dispose()
    {
        try
        {
            _controller?.Disconnect();
        }
        catch
        {
            // best-effort on shutdown
        }
        _client?.Dispose();
    }
}

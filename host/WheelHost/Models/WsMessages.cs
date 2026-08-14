using System.Text.Json;

namespace WheelHost.Models;

/// <summary>
/// Outgoing (host -> client) message shapes. Incoming client messages are read with
/// <see cref="JsonDocument"/> in <see cref="Services.GameServer"/> instead of typed records,
/// since the client sends a handful of differently-shaped messages keyed by "type" and a
/// couple of quick property lookups there is simpler than a polymorphic converter.
/// </summary>
public record WelcomeMessage
{
    public string Type => "welcome";
}

public record ErrorMessage(string Message)
{
    public string Type => "error";
}

public record PongMessage(long T)
{
    public string Type => "pong";
}

public static class WsJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
}

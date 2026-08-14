using System.Security.Cryptography;

namespace WheelHost.Services;

public static class JoinCodeGenerator
{
    /// <summary>Generates a random 6-digit join code, zero-padded (e.g. "004821").</summary>
    public static string Generate()
    {
        var value = RandomNumberGenerator.GetInt32(0, 1_000_000);
        return value.ToString("D6");
    }
}

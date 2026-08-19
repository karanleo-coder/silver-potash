using System.IO;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace WheelHost.Services;

/// <summary>
/// Provides a self-signed TLS certificate for GameServer to serve wwwroot over HTTPS instead
/// of plain HTTP.
///
/// This isn't optional polish: modern mobile browsers (iOS Safari, Chrome) refuse to fire
/// deviceorientation/devicemotion events at all on a non-secure origin — no error, the
/// permission prompt can even resolve "granted" and tilt still won't move anything. A LAN
/// address like http://192.168.x.x is never a "secure context" by browser rules (only https:
/// and localhost qualify), so plain HTTP means gyro steering silently cannot work, full stop.
///
/// There's no public domain or CA for a LAN-only app, so this generates and caches a
/// self-signed certificate covering localhost/127.0.0.1 plus every LAN IPv4 address currently
/// on the machine. Each device that connects will see a one-time "connection is not private"
/// warning it has to click through — an accepted trade-off for local-network apps with no
/// public domain (the same pattern used by Home Assistant, Plex, etc. on LAN).
/// </summary>
public static class CertificateService
{
    private static readonly string CertDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WheelHost", "certs");

    private static readonly string PfxPath = Path.Combine(CertDir, "host.pfx");
    private static readonly string MetaPath = Path.Combine(CertDir, "meta.json");
    private const string Password = "wheelhost-local"; // not a secret — file is protected by the user's own profile ACLs, same as settings.json

    private record CertMeta(List<string> Sans, DateTime NotAfterUtc);

    /// <summary>Loads the cached certificate if it still covers all current LAN IPs and hasn't
    /// expired, otherwise generates and caches a fresh one.</summary>
    public static X509Certificate2 GetOrCreate()
    {
        var wantedSans = BuildSanList();

        if (TryLoadCached(wantedSans, out var cached)) return cached!;

        var fresh = Generate(wantedSans);
        TryPersist(fresh, wantedSans);
        return fresh;
    }

    private static List<string> BuildSanList()
    {
        var sans = new List<string> { "localhost", "127.0.0.1" };
        foreach (var ip in NetworkHelper.GetLanIPv4Addresses())
        {
            var text = ip.ToString();
            if (!sans.Contains(text)) sans.Add(text);
        }
        return sans;
    }

    private static bool TryLoadCached(List<string> wantedSans, out X509Certificate2? cert)
    {
        cert = null;
        try
        {
            if (!File.Exists(PfxPath) || !File.Exists(MetaPath)) return false;

            var meta = JsonSerializer.Deserialize<CertMeta>(File.ReadAllText(MetaPath));
            if (meta is null) return false;
            if (meta.NotAfterUtc <= DateTime.UtcNow.AddDays(7)) return false; // renew a week before expiry
            if (!meta.Sans.OrderBy(s => s).SequenceEqual(wantedSans.OrderBy(s => s))) return false;

            cert = new X509Certificate2(PfxPath, Password, X509KeyStorageFlags.Exportable);
            return true;
        }
        catch
        {
            return false; // corrupt/unreadable cache — fall through to regeneration
        }
    }

    private static X509Certificate2 Generate(List<string> sans)
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(
            "CN=WheelHost Local",
            rsa,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

        request.CertificateExtensions.Add(
            new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, critical: true));
        request.CertificateExtensions.Add(
            new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, critical: false)); // server authentication
        request.CertificateExtensions.Add(
            new X509BasicConstraintsExtension(certificateAuthority: false, hasPathLengthConstraint: false, pathLengthConstraint: 0, critical: true));

        var sanBuilder = new SubjectAlternativeNameBuilder();
        foreach (var san in sans)
        {
            if (System.Net.IPAddress.TryParse(san, out var ip)) sanBuilder.AddIpAddress(ip);
            else sanBuilder.AddDnsName(san);
        }
        request.CertificateExtensions.Add(sanBuilder.Build());

        // Backdated slightly to tolerate minor clock skew between the PC and connecting devices.
        var notBefore = DateTimeOffset.UtcNow.AddMinutes(-5);
        var notAfter = DateTimeOffset.UtcNow.AddYears(2);
        using var generated = request.CreateSelfSigned(notBefore, notAfter);

        // Re-import so the returned certificate has an exportable, persistable private key
        // (CreateSelfSigned's result isn't reliably exportable/persisted on its own).
        return new X509Certificate2(generated.Export(X509ContentType.Pfx, Password), Password, X509KeyStorageFlags.Exportable);
    }

    private static void TryPersist(X509Certificate2 cert, List<string> sans)
    {
        try
        {
            Directory.CreateDirectory(CertDir);
            File.WriteAllBytes(PfxPath, cert.Export(X509ContentType.Pfx, Password));
            File.WriteAllText(MetaPath, JsonSerializer.Serialize(new CertMeta(sans, cert.NotAfter.ToUniversalTime())));
        }
        catch
        {
            // Best-effort cache — worst case we just regenerate next launch.
        }
    }
}

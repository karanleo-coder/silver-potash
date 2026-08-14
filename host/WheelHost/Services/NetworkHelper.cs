using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace WheelHost.Services;

public static class NetworkHelper
{
    /// <summary>All non-loopback IPv4 addresses on interfaces that are currently up (Wi-Fi/Ethernet first).</summary>
    public static List<IPAddress> GetLanIPv4Addresses()
    {
        var results = new List<(IPAddress Address, int Priority)>();

        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

            var priority = nic.NetworkInterfaceType switch
            {
                NetworkInterfaceType.Wireless80211 => 0,
                NetworkInterfaceType.Ethernet => 1,
                _ => 2,
            };

            foreach (var addr in nic.GetIPProperties().UnicastAddresses)
            {
                if (addr.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                if (IPAddress.IsLoopback(addr.Address)) continue;
                results.Add((addr.Address, priority));
            }
        }

        return results.OrderBy(r => r.Priority).Select(r => r.Address).Distinct().ToList();
    }

    public static IPAddress? GetPrimaryLanIPv4() => GetLanIPv4Addresses().FirstOrDefault();
}

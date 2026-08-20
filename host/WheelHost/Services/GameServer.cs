using System.IO;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using WheelHost.Models;

namespace WheelHost.Services;

/// <summary>
/// A tiny hand-rolled HTTPS + WebSocket (wss) server over a raw <see cref="TcpListener"/>.
///
/// Deliberately avoids <see cref="System.Net.HttpListener"/>: binding http.sys to a
/// LAN-visible (non-localhost) prefix normally requires either running elevated or a one-time
/// "netsh http add urlacl" reservation. A plain TCP socket has no such restriction, so this
/// keeps WheelHost a normal, non-admin desktop app. WebSocket framing itself is still handled
/// by the BCL via <see cref="WebSocket.CreateFromStream"/> once the handshake is done by hand.
///
/// Every connection is wrapped in TLS via <see cref="SslStream"/> using a self-signed
/// certificate from <see cref="CertificateService"/> — see that class for why plain HTTP
/// can't be used at all (mobile browsers refuse to fire tilt/motion sensor events on a
/// non-secure origin).
/// </summary>
public class GameServer : IDisposable
{
    private const int JoinTimeoutSeconds = 5;
    private const double WatchdogTimeoutSeconds = 1.5;

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".js"] = "application/javascript; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".ico"] = "image/x-icon",
        [".json"] = "application/json; charset=utf-8",
    };

    private readonly VirtualControllerService _controller;
    private readonly string _wwwrootPath;
    private readonly X509Certificate2 _certificate;

    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Timer? _watchdogTimer;

    private readonly object _sessionLock = new();
    private WebSocket? _activeSocket;
    private DeviceSession? _activeDevice;
    private DateTime _lastMessageUtc;

    public int Port { get; private set; }
    public string JoinCode { get; private set; } = JoinCodeGenerator.Generate();
    public ControllerMapping Mapping { get; set; } = ControllerMapping.Default();

    public event Action<string>? DeviceConnected;
    public event Action<string>? DeviceDisconnected;

    public DeviceSession? ActiveDevice
    {
        get { lock (_sessionLock) return _activeDevice; }
    }

    public GameServer(VirtualControllerService controller, string wwwrootPath)
    {
        _controller = controller;
        _wwwrootPath = wwwrootPath;
        _certificate = CertificateService.GetOrCreate();
    }

    public void Start(int port)
    {
        Port = port;
        _cts = new CancellationTokenSource();
        _listener = new TcpListener(IPAddress.Any, port);
        _listener.Start();
        _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
        _watchdogTimer = new Timer(WatchdogTick, null, TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(500));
    }

    public string RegenerateJoinCode()
    {
        JoinCode = JoinCodeGenerator.Generate();
        return JoinCode;
    }

    /// <summary>Force-disconnects the current controller device, if any (host-initiated "Disconnect device").</summary>
    public void DisconnectActiveDevice()
    {
        WebSocket? active;
        lock (_sessionLock)
        {
            active = _activeSocket;
            _activeSocket = null;
            _activeDevice = null;
        }

        if (active == null) return;
        _controller.ResetAll(Mapping);
        DeviceDisconnected?.Invoke("disconnected by host");
        _ = CloseAsync(active, "disconnected by host");
    }

    public void Stop()
    {
        _cts?.Cancel();
        _watchdogTimer?.Dispose();
        _watchdogTimer = null;
        try { _listener?.Stop(); } catch { /* already stopped */ }

        WebSocket? active;
        lock (_sessionLock)
        {
            active = _activeSocket;
            _activeSocket = null;
            _activeDevice = null;
        }
        if (active != null) _ = CloseAsync(active, "server stopped");
    }

    public void Dispose() => Stop();

    // ---------------------------------------------------------------- accept loop

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener!.AcceptTcpClientAsync(ct);
            }
            catch
            {
                break; // listener stopped / cancelled
            }
            _ = HandleConnectionAsync(client, ct);
        }
    }

    private async Task HandleConnectionAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            client.NoDelay = true;

            await using var sslStream = new SslStream(client.GetStream(), leaveInnerStreamOpen: false);
            try
            {
                await sslStream.AuthenticateAsServerAsync(
                    new SslServerAuthenticationOptions
                    {
                        ServerCertificate = _certificate,
                        ClientCertificateRequired = false,
                        EnabledSslProtocols = SslProtocols.None, // let the OS negotiate the best mutually supported version
                    },
                    ct);
            }
            catch
            {
                // TLS handshake failed — e.g. a stray plain-HTTP probe hitting the port. Nothing
                // useful to do but drop the connection.
                return;
            }

            Stream stream = sslStream;

            string headerBlock;
            try
            {
                headerBlock = await ReadHttpHeaderBlockAsync(stream, ct);
            }
            catch
            {
                return;
            }

            var (method, path, headers) = ParseHttpRequest(headerBlock);
            if (method != "GET")
            {
                await WriteSimpleResponseAsync(stream, 405, "text/plain", "Method not allowed"u8.ToArray());
                return;
            }

            var pathOnly = path.Split('?')[0];
            var isWsUpgrade = pathOnly == "/ws" &&
                headers.TryGetValue("Upgrade", out var upgradeVal) &&
                upgradeVal.Contains("websocket", StringComparison.OrdinalIgnoreCase);

            if (isWsUpgrade)
            {
                if (!headers.TryGetValue("Sec-WebSocket-Key", out var wsKey))
                {
                    await WriteSimpleResponseAsync(stream, 400, "text/plain", "Missing Sec-WebSocket-Key"u8.ToArray());
                    return;
                }

                await CompleteWebSocketHandshakeAsync(stream, wsKey);
                var socket = WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.FromSeconds(30));
                await HandleWebSocketSessionAsync(socket, ct);
            }
            else
            {
                await ServeStaticFileAsync(stream, path);
            }
        }
    }

    // ---------------------------------------------------------------- HTTP parsing / static files

    private static async Task<string> ReadHttpHeaderBlockAsync(Stream stream, CancellationToken ct)
    {
        var buffer = new List<byte>(512);
        var tail = new byte[4];
        var single = new byte[1];

        while (true)
        {
            var read = await stream.ReadAsync(single.AsMemory(0, 1), ct);
            if (read == 0) throw new IOException("Connection closed while reading request headers");

            buffer.Add(single[0]);
            tail[0] = tail[1]; tail[1] = tail[2]; tail[2] = tail[3]; tail[3] = single[0];
            if (tail[0] == '\r' && tail[1] == '\n' && tail[2] == '\r' && tail[3] == '\n') break;

            if (buffer.Count > 16 * 1024) throw new IOException("Request header too large");
        }

        return Encoding.ASCII.GetString(buffer.ToArray());
    }

    private static (string Method, string Path, Dictionary<string, string> Headers) ParseHttpRequest(string block)
    {
        var lines = block.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        var requestLine = lines.Length > 0 ? lines[0].Split(' ') : Array.Empty<string>();
        var method = requestLine.Length > 0 ? requestLine[0] : "";
        var path = requestLine.Length > 1 ? requestLine[1] : "/";

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 1; i < lines.Length; i++)
        {
            var idx = lines[i].IndexOf(':');
            if (idx <= 0) continue;
            headers[lines[i][..idx].Trim()] = lines[i][(idx + 1)..].Trim();
        }

        return (method, path, headers);
    }

    private async Task ServeStaticFileAsync(Stream stream, string rawPath)
    {
        var path = Uri.UnescapeDataString(rawPath.Split('?')[0]);
        if (path == "/") path = "/index.html";

        if (path.Contains(".."))
        {
            await WriteSimpleResponseAsync(stream, 400, "text/plain", "Bad request"u8.ToArray());
            return;
        }

        var relative = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var filePath = Path.Combine(_wwwrootPath, relative);

        if (!File.Exists(filePath))
        {
            await WriteSimpleResponseAsync(stream, 404, "text/plain", "Not found"u8.ToArray());
            return;
        }

        var bytes = await File.ReadAllBytesAsync(filePath);
        var ext = Path.GetExtension(filePath);
        var contentType = ContentTypes.GetValueOrDefault(ext, "application/octet-stream");
        await WriteSimpleResponseAsync(stream, 200, contentType, bytes);
    }

    private static async Task WriteSimpleResponseAsync(Stream stream, int statusCode, string contentType, byte[] body)
    {
        var statusText = statusCode switch
        {
            200 => "OK",
            400 => "Bad Request",
            404 => "Not Found",
            405 => "Method Not Allowed",
            _ => "Error",
        };
        // no-cache forces the phone to revalidate every asset against this server instead of
        // trusting a heuristic-cached copy — without it, a device that ever cached a stale or
        // truncated stylesheet keeps rendering the wheel UI broken/unstyled until its cache
        // happens to expire, including across app updates that changed wwwroot.
        var header =
            $"HTTP/1.1 {statusCode} {statusText}\r\n" +
            $"Content-Type: {contentType}\r\n" +
            $"Content-Length: {body.Length}\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n\r\n";

        await stream.WriteAsync(Encoding.ASCII.GetBytes(header));
        await stream.WriteAsync(body);
        await stream.FlushAsync();
    }

    private static async Task CompleteWebSocketHandshakeAsync(Stream stream, string secWebSocketKey)
    {
        const string magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(secWebSocketKey + magic)));
        var response =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            $"Sec-WebSocket-Accept: {accept}\r\n\r\n";

        await stream.WriteAsync(Encoding.ASCII.GetBytes(response));
        await stream.FlushAsync();
    }

    // ---------------------------------------------------------------- WebSocket session

    private async Task HandleWebSocketSessionAsync(WebSocket socket, CancellationToken serverCt)
    {
        var buffer = new byte[4096];
        var becameActive = false;

        try
        {
            using var joinCts = CancellationTokenSource.CreateLinkedTokenSource(serverCt);
            joinCts.CancelAfter(TimeSpan.FromSeconds(JoinTimeoutSeconds));

            var joinResult = await socket.ReceiveAsync(buffer, joinCts.Token);
            if (joinResult.MessageType != WebSocketMessageType.Text)
            {
                await CloseAsync(socket, "expected join message");
                return;
            }

            var joinJson = Encoding.UTF8.GetString(buffer, 0, joinResult.Count);
            using var joinDoc = JsonDocument.Parse(joinJson);
            var root = joinDoc.RootElement;

            if (!root.TryGetProperty("type", out var typeEl) || typeEl.GetString() != "join")
            {
                await SendJsonAsync(socket, new ErrorMessage("Expected join message"));
                await CloseAsync(socket, "protocol error");
                return;
            }

            var code = root.TryGetProperty("code", out var codeEl) ? codeEl.GetString() : null;
            var deviceName = root.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null;
            if (string.IsNullOrWhiteSpace(deviceName)) deviceName = "Driver";

            if (!string.Equals(code, JoinCode, StringComparison.Ordinal))
            {
                await SendJsonAsync(socket, new ErrorMessage("Invalid code"));
                await CloseAsync(socket, "invalid code");
                return;
            }

            lock (_sessionLock)
            {
                if (_activeSocket == null)
                {
                    _activeSocket = socket;
                    _activeDevice = new DeviceSession(deviceName!, DateTime.UtcNow);
                    _lastMessageUtc = DateTime.UtcNow;
                    becameActive = true;
                }
            }

            if (!becameActive)
            {
                await SendJsonAsync(socket, new ErrorMessage("Host already has a connected controller"));
                await CloseAsync(socket, "busy");
                return;
            }

            await SendJsonAsync(socket, new WelcomeMessage());
            DeviceConnected?.Invoke(deviceName!);

            while (socket.State == WebSocketState.Open && !serverCt.IsCancellationRequested)
            {
                WebSocketReceiveResult result;
                try
                {
                    result = await socket.ReceiveAsync(buffer, serverCt);
                }
                catch
                {
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text) continue;

                lock (_sessionLock) { _lastMessageUtc = DateTime.UtcNow; }

                HandleClientMessage(Encoding.UTF8.GetString(buffer, 0, result.Count), socket);
            }
        }
        catch
        {
            // join timeout, malformed join payload, or transport error — fall through to cleanup
        }
        finally
        {
            var wasActive = false;
            lock (_sessionLock)
            {
                if (ReferenceEquals(_activeSocket, socket))
                {
                    _activeSocket = null;
                    _activeDevice = null;
                    wasActive = true;
                }
            }

            if (wasActive)
            {
                _controller.ResetAll(Mapping);
                DeviceDisconnected?.Invoke("disconnected");
            }

            await CloseAsync(socket, "session ended");
        }
    }

    private void HandleClientMessage(string json, WebSocket socket)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl)) return;

            switch (typeEl.GetString())
            {
                case "motion":
                    if (root.TryGetProperty("steer", out var steerEl))
                        _controller.SetSteering(steerEl.GetDouble());
                    break;

                case "button":
                    if (root.TryGetProperty("action", out var actionEl) &&
                        root.TryGetProperty("state", out var stateEl) &&
                        TryParseAction(actionEl.GetString(), out var action))
                    {
                        _controller.SetButton(action, stateEl.GetString() == "down", Mapping);
                    }
                    break;

                case "ping":
                    if (root.TryGetProperty("t", out var tEl))
                        _ = SendJsonAsync(socket, new PongMessage(tEl.GetInt64()));
                    break;
            }
        }
        catch (JsonException)
        {
            // malformed frame — ignore, the next one will likely be fine
        }
    }

    private static bool TryParseAction(string? raw, out ButtonAction action)
    {
        switch (raw)
        {
            case "accelerate": action = ButtonAction.Accelerate; return true;
            case "brake": action = ButtonAction.Brake; return true;
            case "gearUp": action = ButtonAction.GearUp; return true;
            case "gearDown": action = ButtonAction.GearDown; return true;
            case "handbrake": action = ButtonAction.Handbrake; return true;
            case "extra1": action = ButtonAction.Extra1; return true;
            case "extra2": action = ButtonAction.Extra2; return true;
            default: action = default; return false;
        }
    }

    private static async Task SendJsonAsync<T>(WebSocket socket, T message)
    {
        if (socket.State != WebSocketState.Open) return;
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(message, WsJson.Options);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch
        {
            // socket likely closing concurrently — safe to ignore
        }
    }

    private static async Task CloseAsync(WebSocket socket, string reason)
    {
        try
        {
            if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, reason, CancellationToken.None);
        }
        catch
        {
            // already closing/closed
        }
    }

    // ---------------------------------------------------------------- watchdog

    private void WatchdogTick(object? state)
    {
        WebSocket? staleSocket = null;
        lock (_sessionLock)
        {
            if (_activeSocket != null && (DateTime.UtcNow - _lastMessageUtc).TotalSeconds > WatchdogTimeoutSeconds)
            {
                staleSocket = _activeSocket;
                _activeSocket = null;
                _activeDevice = null;
            }
        }

        if (staleSocket != null)
        {
            _controller.ResetAll(Mapping);
            DeviceDisconnected?.Invoke("timeout");
            _ = CloseAsync(staleSocket, "idle timeout");
        }
    }
}

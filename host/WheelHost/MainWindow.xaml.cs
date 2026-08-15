using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using WheelHost.Models;
using WheelHost.Services;

namespace WheelHost;

public partial class MainWindow : Window
{
    private readonly SettingsStore _settingsStore;
    private readonly AppSettings _settings;
    private readonly VirtualControllerService _controller = new();

    private readonly Dictionary<ButtonAction, ComboBox> _mappingCombos = new();
    private readonly Dictionary<ComboBox, ButtonAction> _comboActions = new();
    private readonly Dictionary<ButtonAction, Border> _chips = new();

    private GameServer? _server;
    private bool _serverRunning;
    private bool _isPopulatingCombos;

    private static readonly Xbox360Element[] AllElements = Enum.GetValues<Xbox360Element>();

    public MainWindow(AppSettings settings, SettingsStore settingsStore)
    {
        InitializeComponent();
        _settings = settings;
        _settingsStore = settingsStore;
        ThemeToggleButton.Content = _settings.Theme == "light" ? "🌙" : "☀️";

        MapCombo(ButtonAction.Accelerate, Combo_Accelerate);
        MapCombo(ButtonAction.Brake, Combo_Brake);
        MapCombo(ButtonAction.GearUp, Combo_GearUp);
        MapCombo(ButtonAction.GearDown, Combo_GearDown);
        MapCombo(ButtonAction.Handbrake, Combo_Handbrake);
        MapCombo(ButtonAction.Extra1, Combo_Extra1);
        MapCombo(ButtonAction.Extra2, Combo_Extra2);

        _chips[ButtonAction.Accelerate] = Chip_Accelerate;
        _chips[ButtonAction.Brake] = Chip_Brake;
        _chips[ButtonAction.GearUp] = Chip_GearUp;
        _chips[ButtonAction.GearDown] = Chip_GearDown;
        _chips[ButtonAction.Handbrake] = Chip_Handbrake;
        _chips[ButtonAction.Extra1] = Chip_Extra1;
        _chips[ButtonAction.Extra2] = Chip_Extra2;

        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
        SteeringTrack.SizeChanged += (_, _) => UpdateSteeringThumb(0);
    }

    private void ThemeToggle_Click(object sender, RoutedEventArgs e)
    {
        _settings.Theme = _settings.Theme == "light" ? "dark" : "light";
        ((App)Application.Current).ApplyTheme(_settings.Theme);
        ThemeToggleButton.Content = _settings.Theme == "light" ? "🌙" : "☀️";
        _settingsStore.Save(_settings);
    }

    private void MapCombo(ButtonAction action, ComboBox combo)
    {
        _mappingCombos[action] = combo;
        _comboActions[combo] = action;
    }

    private void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        TryConnectController();
        PopulateMappingCombos();
        UpdateStartStopUi();
        UpdateSteeringThumb(0);
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _server?.Stop();
        _controller.Dispose();
    }

    // ---------------------------------------------------------------- ViGEm

    private void TryConnectController()
    {
        var ok = _controller.Connect();
        ViGemWarningBorder.Visibility = ok ? Visibility.Collapsed : Visibility.Visible;
        ViGemWarningText.Text = _controller.LastError ?? "";
        StartStopButton.IsEnabled = ok || _serverRunning;
    }

    private void RetryVigem_Click(object sender, RoutedEventArgs e) => TryConnectController();

    private void OpenVigemDownload_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                "https://github.com/ViGEm/ViGEmBus/releases") { UseShellExecute = true });
        }
        catch
        {
            // best-effort — if the shell can't open a browser, the warning text still has the URL
        }
    }

    // ---------------------------------------------------------------- Server lifecycle

    private void StartStopButton_Click(object sender, RoutedEventArgs e)
    {
        if (_serverRunning) StopServer();
        else StartServer();
    }

    private void StartServer()
    {
        if (!_controller.IsConnected)
        {
            TryConnectController();
            if (!_controller.IsConnected) return;
        }

        var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        var server = new GameServer(_controller, wwwroot) { Mapping = _settings.Mapping };
        server.DeviceConnected += OnDeviceConnected;
        server.DeviceDisconnected += OnDeviceDisconnected;
        _controller.SteeringChanged += OnSteeringChanged;
        _controller.ButtonChanged += OnButtonChanged;

        try
        {
            server.Start(_settings.Port);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Could not start the server on port {_settings.Port}:\n{ex.Message}",
                "WheelHost", MessageBoxButton.OK, MessageBoxImage.Error);
            server.DeviceConnected -= OnDeviceConnected;
            server.DeviceDisconnected -= OnDeviceDisconnected;
            _controller.SteeringChanged -= OnSteeringChanged;
            _controller.ButtonChanged -= OnButtonChanged;
            return;
        }

        _server = server;
        _serverRunning = true;
        UpdateStartStopUi();
        RefreshConnectionInfo();
    }

    private void StopServer()
    {
        if (_server != null)
        {
            _server.DeviceConnected -= OnDeviceConnected;
            _server.DeviceDisconnected -= OnDeviceDisconnected;
            _server.Stop();
            _server = null;
        }
        _controller.SteeringChanged -= OnSteeringChanged;
        _controller.ButtonChanged -= OnButtonChanged;

        _serverRunning = false;
        UpdateStartStopUi();

        JoinCodeText.Text = "------";
        LanAddressText.Text = "Server not running";
        QrImage.Source = null;
        DeviceStatusText.Text = "No device connected";
        DeviceStatusDot.Fill = (Brush)FindResource("BadBrush");
        DeviceLastSeenText.Text = "";
        DisconnectDeviceButton.IsEnabled = false;
        ResetLivePreview();
    }

    private void UpdateStartStopUi()
    {
        StartStopButton.Content = _serverRunning ? "Stop Server" : "Start Server";
        ServerStatusDot.Fill = (Brush)FindResource(_serverRunning ? "GoodBrush" : "BadBrush");
        ServerStatusText.Text = _serverRunning ? $"Running on port {_settings.Port}" : "Server stopped";
    }

    private void RefreshConnectionInfo()
    {
        if (_server == null) return;

        JoinCodeText.Text = _server.JoinCode;
        var ip = NetworkHelper.GetPrimaryLanIPv4();

        if (ip == null)
        {
            LanAddressText.Text = "No LAN IP found — check your network connection";
            QrImage.Source = null;
            return;
        }

        var url = $"http://{ip}:{_server.Port}/?code={_server.JoinCode}";
        LanAddressText.Text = $"http://{ip}:{_server.Port}";
        QrImage.Source = QrCodeService.GeneratePng(url);
    }

    private void NewCode_Click(object sender, RoutedEventArgs e)
    {
        if (_server == null) return;
        _server.RegenerateJoinCode();
        RefreshConnectionInfo();
    }

    private void CopyUrl_Click(object sender, RoutedEventArgs e)
    {
        if (_server == null) return;
        var ip = NetworkHelper.GetPrimaryLanIPv4();
        if (ip == null) return;
        Clipboard.SetText($"http://{ip}:{_server.Port}/?code={_server.JoinCode}");
    }

    private void DisconnectDevice_Click(object sender, RoutedEventArgs e) => _server?.DisconnectActiveDevice();

    // ---------------------------------------------------------------- device/controller events (background threads)

    private void OnDeviceConnected(string name)
    {
        Dispatcher.Invoke(() =>
        {
            DeviceStatusText.Text = $"Connected: {name}";
            DeviceStatusDot.Fill = (Brush)FindResource("GoodBrush");
            DeviceLastSeenText.Text = $"Connected at {DateTime.Now:T}";
            DisconnectDeviceButton.IsEnabled = true;
        });
    }

    private void OnDeviceDisconnected(string reason)
    {
        Dispatcher.Invoke(() =>
        {
            DeviceStatusText.Text = "No device connected";
            DeviceStatusDot.Fill = (Brush)FindResource("BadBrush");
            DeviceLastSeenText.Text = $"Last disconnect: {reason} at {DateTime.Now:T}";
            DisconnectDeviceButton.IsEnabled = false;
            ResetLivePreview();
        });
    }

    private void OnSteeringChanged(double value)
    {
        Dispatcher.Invoke(() => UpdateSteeringThumb(value));
    }

    private void OnButtonChanged(ButtonAction action, bool pressed)
    {
        Dispatcher.Invoke(() =>
        {
            if (_chips.TryGetValue(action, out var chip))
                chip.Background = (Brush)FindResource(pressed ? "AccentBrush" : "Panel2Brush");
        });
    }

    private void UpdateSteeringThumb(double value)
    {
        var trackWidth = SteeringTrack.ActualWidth;
        if (trackWidth <= 0) return;

        var thumbSize = SteeringThumb.Width;
        var x = (value + 1) / 2 * trackWidth - thumbSize / 2;
        x = Math.Max(0, Math.Min(trackWidth - thumbSize, x));
        SteeringThumb.Margin = new Thickness(x, -2, 0, 0);
    }

    private void ResetLivePreview()
    {
        UpdateSteeringThumb(0);
        foreach (var chip in _chips.Values)
            chip.Background = (Brush)FindResource("Panel2Brush");
    }

    // ---------------------------------------------------------------- mapping editor

    private void PopulateMappingCombos()
    {
        _isPopulatingCombos = true;
        foreach (var (action, combo) in _mappingCombos)
        {
            combo.ItemsSource = AllElements;
            combo.SelectedItem = _settings.Mapping.Get(action);
        }
        _isPopulatingCombos = false;
    }

    private void MappingCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isPopulatingCombos) return;
        if (sender is not ComboBox combo || !_comboActions.TryGetValue(combo, out var action)) return;
        if (combo.SelectedItem is not Xbox360Element element) return;

        _settings.Mapping.Buttons[action] = element;
        if (_server != null) _server.Mapping = _settings.Mapping;
    }

    private void SaveMapping_Click(object sender, RoutedEventArgs e) => _settingsStore.Save(_settings);

    private void ResetMapping_Click(object sender, RoutedEventArgs e)
    {
        _settings.Mapping = ControllerMapping.Default();
        if (_server != null) _server.Mapping = _settings.Mapping;
        PopulateMappingCombos();
    }
}

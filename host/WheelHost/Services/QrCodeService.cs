using System.IO;
using System.Windows.Media.Imaging;
using QRCoder;

namespace WheelHost.Services;

public static class QrCodeService
{
    /// <summary>
    /// Renders a QR code as a frozen (cross-thread-safe) <see cref="BitmapImage"/> using QRCoder's
    /// pure-managed PNG generator, avoiding a System.Drawing.Common dependency entirely.
    /// </summary>
    public static BitmapImage GeneratePng(string text, int pixelsPerModule = 12)
    {
        var generator = new QRCodeGenerator();
        var data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.Q);
        var pngQrCode = new PngByteQRCode(data);
        var bytes = pngQrCode.GetGraphic(pixelsPerModule);

        using var stream = new MemoryStream(bytes);
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        return image;
    }
}

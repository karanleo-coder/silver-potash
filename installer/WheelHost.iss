; Inno Setup script for WheelHost.
; Built by .github/workflows/release.yml, which:
;   1. dotnet-publishes a self-contained win-x64 WheelHost.exe into ..\publish
;   2. downloads the latest ViGEmBus installer into redist\ViGEmBusSetup_x64.exe
;   3. compiles this script with `iscc /DMyAppVersion=<version> WheelHost.iss`
;
; Can also be compiled locally (e.g. for testing) without a version define —
; MyAppVersion falls back to 0.0.0-dev, and if redist\ViGEmBusSetup_x64.exe is
; missing the driver-bundling step is simply skipped.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "WheelHost"
#define MyAppPublisher "Vertex"
#define MyAppExeName "WheelHost.exe"
#define MyAppURL "https://github.com/ViGEm/ViGEmBus"

[Setup]
; Fixed AppId so upgrades/uninstalls target the same install across versions.
AppId={{6E9F0F1D-6C0B-4B60-9C1F-6E1B7B6E5B4A}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=WheelHost-Setup
Compression=lzma2/max
SolidCompression=yes
SetupIconFile=..\host\WheelHost\wwwroot\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
; Everything dotnet publish produced (the self-contained exe + wwwroot).
Source: "..\publish\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
; Bundled driver installer, staged to a temp dir and cleaned up after setup runs.
Source: "redist\ViGEmBusSetup_x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\ViGEmBusSetup_x64.exe"; Parameters: "/quiet /norestart"; \
    StatusMsg: "Installing virtual controller driver..."; \
    Flags: waituntilterminated; Check: ShouldInstallViGEmBus
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; \
    Flags: nowait postinstall skipifsilent

[Code]
function IsViGEmBusInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('sc.exe', 'query ViGEmBus', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
    and (ResultCode = 0);
end;

function ShouldInstallViGEmBus(): Boolean;
begin
  Result := FileExists(ExpandConstant('{tmp}\ViGEmBusSetup_x64.exe')) and not IsViGEmBusInstalled();
end;

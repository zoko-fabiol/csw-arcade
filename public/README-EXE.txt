# CSW Arcade — EXE Lab & Media Edition

New page: **exe.html** (open https://your-domain.com/exe.html after installing).

## What is supported

- **DOS programs (.EXE/.COM/.BAT)**: js-dos (DOSBox/WebAssembly). Load a single DOS executable, a ZIP with its required data files, a folder, or a prebuilt `.jsdos` bundle. Select the executable and press Run. **Windows** executables are not DOS executables and will not work in DOSBox.
- **Classic Windows executables**: The EXE page can inspect Windows file headers locally and links to the separately hosted [ExeBrowser](https://www.exebrowser.com/) Boxedwine/Wine application. The file must be selected again on ExeBrowser. Compatibility is limited, best with old 32-bit apps. This is not Windows or a universal EXE runner.
- **Media files**: Local video/audio player based on browser codecs (MP4/WebM/MP3/WAV/OGG subject to codec support). It does not execute or replace VLC.exe.

## Hosting

Upload/extract this ZIP to `public_html` in Hostinger, preserving directory structure. The new tools are static HTML/CSS/JS. Internet access is needed for the **js-dos** emulator and **JSZip** library, downloaded from their official provider/CDN when needed. The ZIP does not contain an OS, Wine runtime, Windows application, or commercial ROMs.

## License and external dependencies

js-dos/DOSBox: https://js-dos.com/ (GPL-2.0)  
JSZip: https://stuk.github.io/jszip/ (MIT/GPLv3)  
Boxedwine: https://www.boxedwine.org/ (GPL-2.0)  
ExeBrowser (external service): https://www.exebrowser.com/  

No executable is uploaded by CSW Arcade's DOS or media tools. Opening an external service is a separate action, governed by that service's policies. Only run files you trust. Be sure you have permission to use any game or software.

If an EXE is a portable **Windows** VLC file, it will *not* run inside the integrated DOS emulator. Use the native Media Player tab for formats your browser supports, or install VLC locally on a Windows/Linux/macOS computer to use the full application.

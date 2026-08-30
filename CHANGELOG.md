# Changelog

## 1.1.2 — 2026-08-30

- Windows release CI: build Electrobun/Hutch packs with System32 bsdtar via pwsh

## 1.1.1 — 2026-08-30

- Windows release CI: shim bsdtar so Hutch packaging works on GitHub runners

## 1.1.0 — 2026-08-30

- Desktop migrates to Electrobun 2.0.1 (Hutch) with Windows uninstaller support
- Windows Setup artifact renamed to `win-x64-Sendrova-Setup.zip`
- Landing page + SMS relay Worker assets
- Fresh install required when upgrading from Electrobun 1.16 (in-app update 1.x → 2.x not supported)

## 0.1.0 — 2026-08-29

- Standalone public repo (`nareshjois/sendrova`) with Windows GitHub Releases auto-update
- New platform icon packs: `windows/`, `macOS/AppIcon.iconset/`, `linux/`
- Campaign editor: 50/50 layout (message/media/preview | contacts)
- Shared app footer: connection status + Cancel / Save / Start
- Custom Windows titlebar with minimize / maximize / close
- About screen with changelog and developer credit
- Windows Electrobun viewport bounds nudge (titlebar/client rect)
- Micro-animations with reduced-motion support

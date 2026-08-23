import * as vscode from 'vscode';
import { HookInstaller } from './HookInstaller';
import { CacheKeepManager } from './CacheKeepManager';
import { CacheWardenStatusBar } from './StatusBarItem';
import { SidebarProvider } from './SidebarProvider';
import { CacheWardenConfig } from './types';

let activeManager: CacheKeepManager | undefined;
let activeHookInstaller: HookInstaller | undefined;

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function getConfig(): CacheWardenConfig {
  const cfg = vscode.workspace.getConfiguration('cacheWarden');
  return {
    ttlSeconds: boundedNumber(cfg.get('ttlSeconds'), 280, 30, 3600),
    keepAliveDurationSeconds: boundedNumber(cfg.get('keepAliveDurationSeconds'), 1800, 0, 86400),
    keepAliveMaxPings: Math.round(boundedNumber(cfg.get('keepAliveMaxPings'), 7, 1, 100)),
    targets: [...new Set(cfg.get<string[]>('targets', ['claude']).filter(target => target === 'claude' || target === 'codex'))],
    hookEnabled: cfg.get<boolean>('hookEnabled', true),
    showStatusBar: cfg.get<boolean>('showStatusBar', true),
    claudePath: cfg.get<string>('claudePath', ''),
    codexPath: cfg.get<string>('codexPath', ''),
    codexKeepAlive: cfg.get<boolean>('codexKeepAlive', false),
  };
}

export function activate(context: vscode.ExtensionContext) {
  let config = getConfig();

  const hookInstaller = new HookInstaller();
  hookInstaller.registerInstance();
  activeHookInstaller = hookInstaller;
  const manager = new CacheKeepManager(hookInstaller, config);
  activeManager = manager;
  const statusBar = new CacheWardenStatusBar();
  const sidebar = new SidebarProvider(
    context.extensionUri,
    (id) => { manager.toggle(id); },
    (id) => { manager.resetStreak(id); },
    (id) => { void manager.forcePing(id); },
    (id) => { manager.dismiss(id); }
  );

  if (!config.showStatusBar) {
    statusBar.hide();
  }

  context.subscriptions.push(
    manager.onStateChange(states => {
      statusBar.update(states[0], manager.isArmed);
      sidebar.push(states);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cacheWarden')) {
        config = getConfig();
        manager.updateConfig(config);
        if (config.showStatusBar) {
          statusBar.show();
        } else {
          statusBar.hide();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cacheWarden.toggleArmed', () => {
      const armed = manager.toggle();
      if (armed !== undefined) {
        void vscode.window.showInformationMessage(`CacheWarden: Claude cache keep ${armed ? 'enabled' : 'disabled'}.`);
      }
    }),
    vscode.commands.registerCommand('cacheWarden.resetStreak', () => { manager.resetStreak(); }),
    vscode.commands.registerCommand('cacheWarden.sendPingNow', () => { void manager.forcePing(); })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('cacheWarden.panel', sidebar)
  );

  const initial = manager.getStates();
  statusBar.update(initial[0], manager.isArmed);
  sidebar.push(initial);

  context.subscriptions.push(manager, statusBar, sidebar);
}

export function deactivate() {
  activeManager?.dispose();
  activeManager = undefined;
  activeHookInstaller?.releaseInstance();
  activeHookInstaller = undefined;
}

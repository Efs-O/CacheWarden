import * as vscode from 'vscode';
import { HookInstaller } from './HookInstaller';
import { CacheKeepManager } from './CacheKeepManager';
import { CacheWardenStatusBar } from './StatusBarItem';
import { SidebarProvider } from './SidebarProvider';
import { CacheWardenConfig } from './types';

function getConfig(): CacheWardenConfig {
  const cfg = vscode.workspace.getConfiguration('cacheWarden');
  return {
    ttlSeconds: cfg.get<number>('ttlSeconds', 280),
    keepAliveDurationSeconds: cfg.get<number>('keepAliveDurationSeconds', 1800),
    keepAliveMaxPings: cfg.get<number>('keepAliveMaxPings', 7),
    targets: cfg.get<string[]>('targets', ['claude']),
    hookEnabled: cfg.get<boolean>('hookEnabled', true),
    pingMethod: cfg.get<'clipboard' | 'notify'>('pingMethod', 'clipboard'),
    showStatusBar: cfg.get<boolean>('showStatusBar', true),
    claudePath: cfg.get<string>('claudePath', ''),
    codexPath: cfg.get<string>('codexPath', ''),
    codexKeepAlive: cfg.get<boolean>('codexKeepAlive', false),
  };
}

export function activate(context: vscode.ExtensionContext) {
  let config = getConfig();

  const hookInstaller = new HookInstaller();
  const manager = new CacheKeepManager(hookInstaller, config);
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
    vscode.commands.registerCommand('cacheWarden.toggleArmed', () => { manager.toggle(); }),
    vscode.commands.registerCommand('cacheWarden.resetStreak', () => { manager.resetStreak(); }),
    vscode.commands.registerCommand('cacheWarden.sendPingNow', () => { void manager.forcePing(); })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('cacheWarden.panel', sidebar)
  );

  const initial = manager.getStates();
  statusBar.update(initial[0], manager.isArmed);
  sidebar.push(initial);

  context.subscriptions.push(manager, statusBar);
}

export function deactivate() {}

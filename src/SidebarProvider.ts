import * as vscode from 'vscode';
import { SessionState, WebviewMessage } from './types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastSessions: SessionState[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onToggle: (id: string) => void,
    private readonly onReset: (id: string) => void,
    private readonly onPingNow: (id: string) => void,
    private readonly onDismiss: (id: string) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (msg.type === 'toggle') this.onToggle(msg.sessionId);
      if (msg.type === 'reset') this.onReset(msg.sessionId);
      if (msg.type === 'pingNow') this.onPingNow(msg.sessionId);
      if (msg.type === 'dismiss') this.onDismiss(msg.sessionId);
    });

    // Push current state on first load
    if (this.lastSessions.length > 0) {
      this.push(this.lastSessions);
    }
  }

  push(sessions: SessionState[]) {
    this.lastSessions = sessions;
    this.view?.webview.postMessage({ type: 'stateUpdate', sessions });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CacheWarden</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

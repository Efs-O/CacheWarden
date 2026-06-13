import * as vscode from 'vscode';
import { KEEPALIVE_MESSAGE } from './types';

export class PingDispatcher {
  constructor(private pingMethod: 'clipboard' | 'notify') {}

  updateMethod(pingMethod: 'clipboard' | 'notify') {
    this.pingMethod = pingMethod;
  }

  async sendKeepAlive(mode: 'auto' | 'manual'): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(KEEPALIVE_MESSAGE);

      if (this.pingMethod === 'clipboard') {
        await this.tryExecute('workbench.action.chat.open');
        await this.tryExecute('workbench.panel.chat.view.copilot.focus');
        await this.tryExecute('editor.action.clipboardPasteAction');
      }

      const detail = this.pingMethod === 'clipboard'
        ? 'The keepalive was copied to the clipboard and pasted into the current chat input when supported.'
        : 'The keepalive was copied to the clipboard. Paste it into the chat input and press Enter.';
      const prefix = mode === 'auto' ? 'Automatic keepalive ready.' : 'Keepalive ready.';

      void vscode.window.showInformationMessage(`CacheWarden: ${prefix} ${detail}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`CacheWarden: failed to prepare keepalive ping. ${message}`);
      return false;
    }
  }

  private async tryExecute(command: string): Promise<void> {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      // Chat commands vary by host and installed extensions.
    }
  }
}

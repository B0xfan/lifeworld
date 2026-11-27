'use strict';
// The "are you sure" box: one copy for every part (Projects' delete and many-tasks checks, Today's note tick).
import { Modal } from 'obsidian';

class ConfirmModal extends Modal {
  /** @param {import('obsidian').App} app @param {string} title @param {string} text @param {string} okLabel @param {(ok: boolean) => void} done */
  constructor(app, title, text, okLabel, done) { super(app); this.title = title; this.text = text; this.okLabel = okLabel; this.done = done; this.ok = false; }
  onOpen() {
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.text });
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { cls: 'mod-warning', text: this.okLabel }).addEventListener('click', () => { this.ok = true; this.close(); });
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }
  onClose() { this.contentEl.empty(); this.done(this.ok); }
}

// -> true only when the OK button was clicked (Cancel, Escape and a click outside are false).
/** @param {import('obsidian').App} app @param {string} title @param {string} text @param {string} okLabel @returns {Promise<boolean>} */
function confirmAction(app, title, text, okLabel) { return new Promise((resolve) => new ConfirmModal(app, title, text, okLabel, resolve).open()); }

export { confirmAction };

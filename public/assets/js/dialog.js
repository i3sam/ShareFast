import { h, icon, prefersReducedMotion, setBusy } from './dom.js';

// In-app replacement for window.confirm(). Resolves true when confirmed.
// With `onConfirm`, the dialog stays open with a spinner while the action
// runs, and shows the error inline if it fails.
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', iconName, danger = false, onConfirm }) {
  return new Promise((resolve) => {
    const cancelButton = h('button', { type: 'button', class: 'button', autofocus: true }, cancelLabel);
    const confirmButton = h(
      'button',
      { type: 'button', class: `button ${danger ? 'button-destructive' : 'button-primary'}` },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', {}, confirmLabel),
    );
    const error = h('p', { class: 'error', role: 'alert', hidden: true });

    const dialog = h(
      'dialog',
      { class: 'sheet confirm', role: 'alertdialog', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-message' },
      iconName ? h('span', { class: `icon-tile${danger ? ' icon-tile-danger' : ''}` }, icon(iconName, 22)) : null,
      h('h2', { id: 'confirm-title' }, title),
      h('p', { id: 'confirm-message', class: 'muted' }, message),
      error,
      h('div', { class: 'sheet-actions' }, cancelButton, confirmButton),
    );

    let busy = false;

    const dismiss = (confirmed) => {
      dialog.classList.add('is-closing');
      setTimeout(() => dialog.close(confirmed ? 'confirm' : 'cancel'), prefersReducedMotion() ? 0 : 160);
    };

    cancelButton.addEventListener('click', () => !busy && dismiss(false));

    confirmButton.addEventListener('click', async () => {
      if (!onConfirm) {
        dismiss(true);
        return;
      }
      busy = true;
      error.hidden = true;
      setBusy(confirmButton, true);
      cancelButton.disabled = true;
      try {
        await onConfirm();
        dismiss(true);
      } catch (failure) {
        busy = false;
        setBusy(confirmButton, false);
        cancelButton.disabled = false;
        error.textContent = failure.message || 'Something went wrong. Try again.';
        error.hidden = false;
      }
    });

    // Escape and backdrop clicks cancel, unless the action is already running.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!busy) dismiss(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && !busy) dismiss(false);
    });

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'confirm');
    });

    document.body.append(dialog);
    dialog.showModal();
  });
}

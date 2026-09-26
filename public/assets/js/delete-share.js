import { api } from './api.js';
import { confirmDialog } from './dialog.js';
import { h } from './dom.js';
import { forgetShare } from './recent.js';

// Asks first, then deletes. Resolves true once the share is gone.
export function confirmAndDelete(entry) {
  return confirmDialog({
    title: 'Delete this share?',
    message: [
      h('strong', {}, `${location.host}/${entry.slug}`),
      ' will stop working for everyone, and its files are removed right away.',
    ],
    confirmLabel: 'Delete share',
    iconName: 'trash',
    danger: true,
    async onConfirm() {
      try {
        await api.deleteShare(entry.slug, entry.token);
      } catch (error) {
        // Already gone (expired or deleted elsewhere) counts as success.
        if (error.status !== 404) throw error;
      }
      forgetShare(entry.slug);
    },
  });
}

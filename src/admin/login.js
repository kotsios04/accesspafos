/**
 * Console sign-in.
 *
 * Email and password for municipal staff. Roles are Firebase Auth custom
 * claims set by `scripts/set-admin.js`; signing in here grants nothing on its
 * own, which is exactly the point - there is deliberately no path from this
 * screen to elevated permissions.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { getOutlet } from '../components/appShell.js';
import { brandMark } from '../components/icons.js';
import { button, field, banner } from '../components/ui.js';
import { signInWithEmail, signInWithGoogle, sendPasswordReset, isReviewer, initAuth, refreshClaims } from '../services/auth.js';
import { describeError } from '../services/errors.js';
import { toastSuccess } from '../services/toast.js';
import { navigate } from '../router/index.js';

export async function render() {
  await initAuth();
  if (isReviewer()) { navigate('/admin', { replace: true }); return {}; }

  const email = el('input.input', { type: 'email', id: 'admin-email', autocomplete: 'username', required: true });
  const password = el('input.input', { type: 'password', id: 'admin-password', autocomplete: 'current-password', required: true });
  const errorSlot = el('div');
  const submit = button('Sign in', { variant: 'primary', block: true, type: 'submit' });

  const form = el('form.stack', {
    onSubmit: async (event) => {
      event.preventDefault();
      mount(errorSlot);
      submit.disabled = true;
      try {
        await signInWithEmail(email.value.trim(), password.value);
        await refreshClaims();
        if (isReviewer()) {
          navigate('/admin', { replace: true });
        } else {
          mount(errorSlot, banner(
            'That account signed in successfully but has no municipality role. Ask a project administrator to grant one with scripts/set-admin.js.',
            { tone: 'warning' }
          ));
        }
      } catch (error) {
        mount(errorSlot, banner(describeError(error), { tone: 'danger' }));
      } finally {
        submit.disabled = false;
      }
    }
  }, [
    field('Email', email, { id: 'admin-email' }),
    field('Password', password, { id: 'admin-password' }),
    errorSlot,
    submit,
    button('Sign in with Google', {
      variant: 'secondary', block: true,
      onClick: async () => {
        mount(errorSlot);
        try {
          await signInWithGoogle();
          await refreshClaims();
          if (isReviewer()) navigate('/admin', { replace: true });
          else mount(errorSlot, banner('That account has no municipality role yet.', { tone: 'warning' }));
        } catch (error) {
          mount(errorSlot, banner(describeError(error), { tone: 'danger' }));
        }
      }
    }),
    el('button.link-button', {
      type: 'button',
      style: { alignSelf: 'center' },
      onClick: async () => {
        if (!email.value.trim()) { mount(errorSlot, banner('Enter your email address first.', { tone: 'warning' })); return; }
        try {
          await sendPasswordReset(email.value.trim());
          toastSuccess('Password reset email sent.');
        } catch (error) {
          mount(errorSlot, banner(describeError(error), { tone: 'danger' }));
        }
      }
    }, 'Forgot your password?')
  ]);

  mount(getOutlet(), el('div.login-shell', {}, [
    el('div.login-card.stack', {}, [
      el('div.row', { style: { gap: '10px' } }, [
        brandMark(32),
        el('div', {}, [
          el('div.strong', {}, t('app.name')),
          el('div.xs.muted', {}, 'Municipality console')
        ])
      ]),
      form,
      el('div.divider'),
      el('a.small', { href: '/' }, `← ${t('app.goHome')}`)
    ])
  ]));

  return {};
}

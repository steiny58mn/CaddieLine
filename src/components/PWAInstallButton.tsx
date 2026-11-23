import React, { useState } from 'react';
import { Download, ExternalLink, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'default' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'default' }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  const isNativeCapacitor =
    typeof window !== 'undefined' &&
    (Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) ||
      window.location.protocol === 'capacitor:');

  if (isInstalled || isNativeCapacitor) {
    return null;
  }

  const standaloneUrl = typeof window !== 'undefined' ? window.location.origin : '/';

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F1A14] text-white font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 ${
          variant === 'compact' ? 'min-h-[38px] px-3 text-xs' : 'min-h-[44px] px-4 text-xs'
        }`}
      >
        <Download className="w-4 h-4 text-emerald-400" />
        <span>Install Android App</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-[#0F1A14] font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 ${
          variant === 'compact' ? 'min-h-[38px] px-3 text-xs' : 'min-h-[44px] px-4 text-xs'
        }`}
      >
        <Smartphone className="w-4 h-4 text-emerald-700" />
        <span>{isIOS ? 'Install on iOS' : 'Install Android App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="pwa-install-guide-title" className="text-lg font-bold text-[#0F1A14]">
                  {isIOS ? 'Install on iPhone / iPad' : 'Install PocketCaddy on Android'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isIOS
                    ? 'Add PocketCaddy to your Home Screen as a standalone app.'
                    : 'Run PocketCaddy standalone on Android Chrome to enable your hardware NFC reader.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                aria-label="Close install instructions"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-sm text-slate-700 list-decimal pl-5">
                <li>
                  Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong>Add</strong> to launch PocketCaddy from your Home Screen.
                </li>
              </ol>
            ) : (
              <div className="space-y-3 text-xs text-slate-700">
                <ol className="space-y-2 list-decimal pl-4">
                  <li>
                    Open this app directly in <strong>Chrome on your Android phone</strong> (not
                    inside an embedded preview frame).
                  </li>
                  <li>
                    Tap Chrome&apos;s <strong>⋮ menu → Add to Home screen → Install</strong> (or
                    tap the install prompt when Chrome displays it).
                  </li>
                  <li>
                    Open <strong>PocketCaddy</strong> from your Android app drawer/home screen, go
                    to <strong>Bag &amp; NFC</strong>, and tap <strong>Start NFC Scanning</strong>{' '}
                    to scan GolfPad tags.
                  </li>
                </ol>

                {isInIframe && (
                  <a
                    href={standaloneUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[44px] px-4 rounded-xl bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-2 hover:bg-emerald-800 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Open Standalone App Tab</span>
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-slate-100 text-xs font-semibold text-slate-800 hover:bg-slate-200 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};

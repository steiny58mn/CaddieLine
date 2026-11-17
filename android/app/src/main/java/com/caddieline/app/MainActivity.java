package com.caddieline.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity implements NfcAdapter.ReaderCallback {

    private NfcAdapter nfcAdapter;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureShowWhenLocked();
        initNfc();
        handleIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        configureShowWhenLocked();
        enableNfcReaderMode();
    }

    @Override
    public void onPause() {
        super.onPause();
        disableNfcReaderMode();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        configureShowWhenLocked();
        wakeDeviceUp();
        handleIntent(intent);
    }

    /**
     * Wakes the display and shows CaddieLine directly over the lock screen
     * without requiring PIN/fingerprint unlock.
     */
    private void configureShowWhenLocked() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }
    }

    private void wakeDeviceUp() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (wakeLock == null) {
                    wakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                        PowerManager.ACQUIRE_CAUSES_WAKEUP |
                        PowerManager.ON_AFTER_RELEASE,
                        "CaddieLine:NfcWakeLock"
                    );
                }
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire(3000);
                }
            }
        } catch (Exception ignored) {}
    }

    private void initNfc() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
    }

    private void enableNfcReaderMode() {
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            Bundle options = new Bundle();
            options.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 200);
            nfcAdapter.enableReaderMode(
                this,
                this,
                NfcAdapter.FLAG_READER_NFC_A |
                NfcAdapter.FLAG_READER_NFC_B |
                NfcAdapter.FLAG_READER_NFC_F |
                NfcAdapter.FLAG_READER_NFC_V |
                NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
                options
            );
        }
    }

    private void disableNfcReaderMode() {
        if (nfcAdapter != null) {
            nfcAdapter.disableReaderMode(this);
        }
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        processTag(tag);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_TECH_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)) {
            Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
            if (tag != null) {
                processTag(tag);
            }
        }
    }

    private void processTag(Tag tag) {
        if (tag == null) return;

        byte[] idBytes = tag.getId();
        final String tagId = bytesToHex(idBytes);
        final String ndefText = readNdefText(tag);

        // Haptic pulse confirming tag read
        vibratePhone();

        // Wake screen & show over lock screen
        wakeDeviceUp();

        // Dispatch tag event to React frontend
        runOnUiThread(() -> {
            String script = String.format(
                "window.dispatchEvent(new CustomEvent('nativeNfcTag', { detail: { tagId: '%s', text: '%s' } }));",
                tagId,
                escapeForJs(ndefText)
            );
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    private String readNdefText(Tag tag) {
        try {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                NdefMessage message = ndef.getCachedNdefMessage();
                if (message == null) {
                    message = ndef.getNdefMessage();
                }
                if (message != null && message.getRecords().length > 0) {
                    NdefRecord record = message.getRecords()[0];
                    byte[] payload = record.getPayload();
                    if (payload != null && payload.length > 0) {
                        int languageCodeLength = payload[0] & 0063;
                        return new String(
                            payload,
                            languageCodeLength + 1,
                            payload.length - languageCodeLength - 1,
                            StandardCharsets.UTF_8
                        );
                    }
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    private void vibratePhone() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(new long[]{0, 90, 60, 90}, -1));
                } else {
                    v.vibrate(new long[]{0, 90, 60, 90}, -1);
                }
            }
        } catch (Exception ignored) {}
    }

    private static String bytesToHex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X", b));
        }
        return sb.toString();
    }

    private static String escapeForJs(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", "");
    }
}

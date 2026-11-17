package com.caddieline.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
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
import android.view.MotionEvent;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity implements NfcAdapter.ReaderCallback {

    private NfcAdapter nfcAdapter;
    private PowerManager.WakeLock wakeLock;

    // Pocket detection & screen dimming
    private SensorManager sensorManager;
    private Sensor proximitySensor;
    private volatile boolean isNear = false;

    private final SensorEventListener proximityListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event.sensor.getType() == Sensor.TYPE_PROXIMITY) {
                float distance = event.values[0];
                float maxRange = event.sensor.getMaximumRange();
                // Proximity sensors either return binary (0.0 or maxRange) or continuous distance in cm.
                // A reading strictly below min(maxRange, 4.0f) or == 0.0f means covered (in pocket).
                boolean near = distance < Math.min(maxRange, 4.0f) || distance == 0.0f;
                if (near != isNear) {
                    isNear = near;
                    applyPocketMode(near);
                }
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        // Clamp app bounds strictly between top status bar and bottom navigation bar / gestures
        getWindow().setStatusBarColor(android.graphics.Color.BLACK);
        getWindow().setNavigationBarColor(android.graphics.Color.BLACK);
        android.view.View decorView = getWindow().getDecorView();
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(
                androidx.core.view.WindowInsetsCompat.Type.systemBars() |
                androidx.core.view.WindowInsetsCompat.Type.displayCutout()
            );
            android.view.View contentView = findViewById(android.R.id.content);
            if (contentView != null) {
                contentView.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });
        androidx.core.view.ViewCompat.requestApplyInsets(decorView);

        configureShowWhenLocked();
        initNfc();
        initPocketDetection();
        handleIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        configureShowWhenLocked();
        enableNfcReaderMode();
        registerPocketDetection();
    }

    @Override
    public void onPause() {
        super.onPause();
        disableNfcReaderMode();
        unregisterPocketDetection();
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (isNear) {
            // Screen is in pocket: discard touch interaction completely
            return true;
        }
        return super.dispatchTouchEvent(ev);
    }

    private void initPocketDetection() {
        try {
            sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            if (sensorManager != null) {
                proximitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY);
            }
        } catch (Exception ignored) {}
    }

    private void registerPocketDetection() {
        try {
            if (sensorManager != null && proximitySensor != null) {
                sensorManager.registerListener(proximityListener, proximitySensor, SensorManager.SENSOR_DELAY_UI);
            }
        } catch (Exception ignored) {}
    }

    private void unregisterPocketDetection() {
        try {
            if (sensorManager != null && proximitySensor != null) {
                sensorManager.unregisterListener(proximityListener);
            }
        } catch (Exception ignored) {}
        if (isNear) {
            isNear = false;
            applyPocketMode(false);
        }
    }

    private void applyPocketMode(boolean inPocket) {
        runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                if (inPocket) {
                    // Dim screen backlight to lowest possible level
                    lp.screenBrightness = 0.01f;
                } else {
                    // Restore default system/user brightness
                    lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                }
                getWindow().setAttributes(lp);
            } catch (Exception ignored) {}

            try {
                String script = String.format(
                    "window.dispatchEvent(new CustomEvent('pocketModeState', { detail: { inPocket: %b } }));",
                    inPocket
                );
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(script, null);
                }
            } catch (Exception ignored) {}
        });
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

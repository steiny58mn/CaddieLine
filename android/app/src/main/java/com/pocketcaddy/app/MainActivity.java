package com.pocketcaddy.app;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import android.util.Log;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity implements NfcAdapter.ReaderCallback {

    private static final String TAG = "PocketCaddy";

    private static final String PATH_DISTANCES = "/pocketcaddy/distances";
    private static final String PATH_START_ROUND = "/pocketcaddy/start_round";
    private static final String PATH_CLUB_SCANNED = "/pocketcaddy/club_scanned";

    public static volatile MainActivity sInstance = null;
    public static volatile String sCachedDistancesJson = null;

    private NfcAdapter nfcAdapter;
    private PowerManager.WakeLock wakeLock;

    // Feedback configuration from React UI
    private volatile boolean vibrateEnabled = true;
    private volatile boolean soundEnabled = true;
    private volatile boolean screenWasPoweredOff = false;

    // Pocket detection & screen dimming
    private SensorManager sensorManager;
    private Sensor proximitySensor;
    private volatile boolean isNear = false;

    // Wear OS communication
    private final ExecutorService wearExecutor = Executors.newSingleThreadExecutor();

    private final SensorEventListener proximityListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event.sensor.getType() == Sensor.TYPE_PROXIMITY) {
                float distance = event.values[0];
                float maxRange = event.sensor.getMaximumRange();
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

    private final BroadcastReceiver screenStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                screenWasPoweredOff = true;
                dispatchPhoneLockedNotice(true);
            } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                screenWasPoweredOff = false;
                dispatchPhoneLockedNotice(false);
            }
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;

        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

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
        setupFeedbackBridge();

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(screenStateReceiver, filter);

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

        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        boolean isLocked = km != null && (km.isKeyguardLocked() || km.isDeviceLocked());
        if (isLocked) {
            dispatchPhoneLockedNotice(true);
        } else {
            screenWasPoweredOff = false;
            dispatchPhoneLockedNotice(false);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        disableNfcReaderMode();
        unregisterPocketDetection();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(screenStateReceiver);
        } catch (Exception ignored) {}
        unregisterPocketDetection();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        sendCloseSignalToWatch();
        wearExecutor.shutdown();
        if (sInstance == this) {
            sInstance = null;
        }
    }

    private void sendCloseSignalToWatch() {
        wearExecutor.execute(() -> {
            try {
                List<Node> nodes = Tasks.await(Wearable.getNodeClient(this).getConnectedNodes());
                for (Node node : nodes) {
                    Wearable.getMessageClient(this).sendMessage(
                        node.getId(),
                        "/pocketcaddy/close_round",
                        new byte[0]
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    private void setupFeedbackBridge() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void setFeedbackConfig(boolean vibrate, boolean sound) {
                    vibrateEnabled = vibrate;
                    soundEnabled = sound;
                    Log.i(TAG, "Feedback config updated: vibrate=" + vibrate + ", sound=" + sound);
                }

                @JavascriptInterface
                public void triggerHaptic() {
                    vibratePhone();
                }

                @JavascriptInterface
                public void playChime() {
                    playScanSound();
                }

                @JavascriptInterface
                public void wakeScreen() {
                    wakeDeviceUp();
                }

                @JavascriptInterface
                public void requestDeviceUnlock() {
                    runOnUiThread(() -> {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                                if (km != null && km.isKeyguardLocked()) {
                                    km.requestDismissKeyguard(MainActivity.this, new KeyguardManager.KeyguardDismissCallback() {
                                        @Override
                                        public void onDismissSucceeded() {
                                            super.onDismissSucceeded();
                                            screenWasPoweredOff = false;
                                            dispatchPhoneLockedNotice(false);
                                        }
                                    });
                                }
                            }
                        } catch (Exception ignored) {}
                    });
                }

                @JavascriptInterface
                public void updateWatchDistances(boolean roundActive, String courseName, int hole, int par, int front, int pin, int back, String unit) {
                    sendDistancesToWatch(roundActive, courseName, hole, par, front, pin, back, unit);
                }

                @JavascriptInterface
                public void notifyWatchClubScanned(String clubName, String clubShortName) {
                    sendClubScannedToWatch(clubName, clubShortName);
                }
            }, "NativeFeedback");
        }
    }

    private void sendDistancesToWatch(boolean roundActive, String courseName, int hole, int par, int front, int pin, int back, String unit) {
        try {
            JSONObject json = new JSONObject();
            json.put("roundActive", roundActive);
            json.put("courseName", courseName != null ? courseName : "");
            json.put("hole", hole);
            json.put("par", par);
            json.put("front", front);
            json.put("pin", pin);
            json.put("back", back);
            json.put("unit", unit != null ? unit : "yd");
            final String jsonString = json.toString();

            sCachedDistancesJson = jsonString;

            wearExecutor.execute(() -> {
                try {
                    List<Node> nodes = Tasks.await(Wearable.getNodeClient(MainActivity.this).getConnectedNodes());
                    byte[] bytes = jsonString.getBytes(StandardCharsets.UTF_8);
                    for (Node node : nodes) {
                        if (roundActive) {
                            Wearable.getMessageClient(MainActivity.this).sendMessage(node.getId(), PATH_START_ROUND, bytes);
                        } else {
                            Wearable.getMessageClient(MainActivity.this).sendMessage(node.getId(), "/pocketcaddy/close_round", bytes);
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to send distances to watch: " + e.getMessage());
                }
            });
        } catch (Exception ignored) {}
    }

    public void sendClubScannedToWatch(String clubName, String clubShortName) {
        try {
            JSONObject json = new JSONObject();
            json.put("clubName", clubName != null ? clubName : "Club");
            json.put("clubShortName", clubShortName != null ? clubShortName : "");
            json.put("timestamp", System.currentTimeMillis());
            final String jsonString = json.toString();

            wearExecutor.execute(() -> {
                try {
                    List<Node> nodes = Tasks.await(Wearable.getNodeClient(MainActivity.this).getConnectedNodes());
                    byte[] bytes = jsonString.getBytes(StandardCharsets.UTF_8);
                    for (Node node : nodes) {
                        Wearable.getMessageClient(MainActivity.this).sendMessage(node.getId(), PATH_CLUB_SCANNED, bytes);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to send club_scanned to watch: " + e.getMessage());
                }
            });
        } catch (Exception ignored) {}
    }

    public static void handleWatchLogShot(Context context, String clubId, String clubName, String lie, String direction) {
        if (sInstance != null && !sInstance.isFinishing()) {
            sInstance.processWatchLogShot(clubId, clubName, lie, direction);
        } else {
            try {
                Intent intent = new Intent(context, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.putExtra("watch_shot_club_id", clubId);
                intent.putExtra("watch_shot_club_name", clubName);
                intent.putExtra("watch_shot_lie", lie);
                intent.putExtra("watch_shot_direction", direction);
                context.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    public static void handleWatchTagScanned(Context context, String tagId, String text) {
        if (sInstance != null && !sInstance.isFinishing()) {
            sInstance.processWatchTag(tagId, text);
        } else {
            try {
                Intent intent = new Intent(context, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.putExtra("watch_tag_id", tagId);
                intent.putExtra("watch_tag_text", text);
                context.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    public static void handleWatchHoleChange(String action) {
        if (sInstance != null && !sInstance.isFinishing()) {
            sInstance.processWatchHoleChange(action);
        }
    }

    public void processWatchLogShot(String clubId, String clubName, String lie, String direction) {
        Log.i(TAG, "Watch logged shot: Club=" + clubName + " (" + clubId + "), Lie=" + lie + ", Dir=" + direction);

        vibratePhone();
        playScanSound();
        wakeDeviceUp();

        runOnUiThread(() -> {
            String script = String.format(
                "window.dispatchEvent(new CustomEvent('watchLogShot', { detail: { clubId: '%s', clubName: '%s', lie: '%s', direction: '%s' } }));",
                escapeForJs(clubId),
                escapeForJs(clubName),
                escapeForJs(lie),
                escapeForJs(direction)
            );
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    public void processWatchTag(String tagId, String text) {
        Log.i(TAG, "Watch scanned tag: ID=" + tagId + ", Club=" + text);

        vibratePhone();
        playScanSound();
        wakeDeviceUp();

        runOnUiThread(() -> {
            String script = String.format(
                "window.dispatchEvent(new CustomEvent('nativeNfcTag', { detail: { tagId: '%s', text: '%s', source: 'watch' } }));",
                tagId,
                escapeForJs(text)
            );
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    public void processWatchHoleChange(String action) {
        runOnUiThread(() -> {
            String script = String.format(
                "window.dispatchEvent(new CustomEvent('watchHoleChange', { detail: { action: '%s' } }));",
                escapeForJs(action)
            );
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    private void dispatchPhoneLockedNotice(boolean locked) {
        runOnUiThread(() -> {
            try {
                String script = String.format(
                    "window.dispatchEvent(new CustomEvent('phoneLockedNotice', { detail: { locked: %b } }));",
                    locked
                );
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(script, null);
                }
            } catch (Exception ignored) {}
        });
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
                    lp.screenBrightness = 0.01f;
                } else {
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

    private void configureShowWhenLocked() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
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
                        "PocketCaddy:NfcWakeLock"
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
            Log.i(TAG, "Enabling NFC Reader Mode on phone");
            Bundle options = new Bundle();
            options.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 100);
            nfcAdapter.enableReaderMode(
                this,
                this,
                NfcAdapter.FLAG_READER_NFC_A |
                NfcAdapter.FLAG_READER_NFC_B |
                NfcAdapter.FLAG_READER_NFC_F |
                NfcAdapter.FLAG_READER_NFC_V,
                options
            );
        } else {
            Log.w(TAG, "NFC is null or not enabled on this phone");
        }
    }

    private void disableNfcReaderMode() {
        if (nfcAdapter != null) {
            try {
                nfcAdapter.disableReaderMode(this);
            } catch (Exception ignored) {}
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
        if (intent.hasExtra("watch_shot_club_id")) {
            String clubId = intent.getStringExtra("watch_shot_club_id");
            String clubName = intent.getStringExtra("watch_shot_club_name");
            String lie = intent.getStringExtra("watch_shot_lie");
            String direction = intent.getStringExtra("watch_shot_direction");
            processWatchLogShot(clubId, clubName, lie, direction);
        } else if (intent.hasExtra("watch_tag_id")) {
            String tagId = intent.getStringExtra("watch_tag_id");
            String text = intent.getStringExtra("watch_tag_text");
            processWatchTag(tagId, text);
        }
    }

    private void processTag(Tag tag) {
        if (tag == null) return;

        byte[] idBytes = tag.getId();
        final String tagId = bytesToHex(idBytes);
        final String ndefText = readNdefText(tag);

        Log.i(TAG, "NFC Tag Scanned! ID=" + tagId + ", Text=" + ndefText);

        vibratePhone();
        playScanSound();
        wakeDeviceUp();

        // If tag contains NDEF text, send early alert to watch
        if (ndefText != null && !ndefText.trim().isEmpty()) {
            sendClubScannedToWatch(ndefText.trim(), ndefText.trim());
        }

        runOnUiThread(() -> {
            String script = String.format(
                "window.dispatchEvent(new CustomEvent('nativeNfcTag', { detail: { tagId: '%s', text: '%s', source: 'phone' } }));",
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
                    for (NdefRecord record : message.getRecords()) {
                        String payload = parseRecordPayload(record);
                        if (payload != null && !payload.trim().isEmpty()) {
                            return payload.trim();
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error reading NDEF: " + e.getMessage());
        }
        return "";
    }

    private String parseRecordPayload(NdefRecord record) {
        try {
            byte[] payload = record.getPayload();
            if (payload == null || payload.length == 0) return null;

            short tnf = record.getTnf();
            byte[] type = record.getType();

            if (tnf == NdefRecord.TNF_WELL_KNOWN && java.util.Arrays.equals(type, NdefRecord.RTD_TEXT)) {
                int status = payload[0] & 0xFF;
                int langCodeLen = status & 0x3F;
                int textLen = payload.length - 1 - langCodeLen;
                if (textLen > 0) {
                    return new String(payload, 1 + langCodeLen, textLen, StandardCharsets.UTF_8);
                }
            }

            return new String(payload, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void vibratePhone() {
        if (!vibrateEnabled) return;
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                long[] timings = new long[]{0, 220, 70, 320};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    int[] amplitudes = new int[]{0, 255, 0, 255};
                    v.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                } else {
                    v.vibrate(timings, -1);
                }
            }
        } catch (Exception ignored) {}
    }

    private void playScanSound() {
        if (!soundEnabled) return;
        try {
            android.media.ToneGenerator tg = new android.media.ToneGenerator(
                android.media.AudioManager.STREAM_NOTIFICATION,
                100
            );
            tg.startTone(android.media.ToneGenerator.TONE_PROP_BEEP2, 220);
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

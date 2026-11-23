package com.pocketcaddy.wear;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity implements MessageClient.OnMessageReceivedListener {

    private static final String TAG = "PocketCaddyWear";

    private static final String PATH_DISTANCES = "/pocketcaddy/distances";
    private static final String PATH_START_ROUND = "/pocketcaddy/start_round";
    private static final String PATH_CLOSE_ROUND = "/pocketcaddy/close_round";
    private static final String PATH_LOG_SHOT = "/pocketcaddy/log_shot";
    private static final String PATH_CLUB_SCANNED = "/pocketcaddy/club_scanned";
    private static final String PATH_HOLE_CHANGE = "/pocketcaddy/hole_change";
    private static final String PATH_REQUEST_SYNC = "/pocketcaddy/request_sync";

    private static final int PERMISSION_REQ_NOTIFICATIONS = 1001;

    // UI overlays
    private View layoutMain;
    private View layoutNoRound;
    private View layoutClubPicker;
    private View layoutShotDetails;
    private View layoutSuccess;

    // Main view elements
    private TextView btnPrevHole;
    private TextView btnNextHole;
    private TextView tvHoleInfo;

    private TextView tvFrontDistance;
    private TextView tvPinDistance;
    private TextView tvBackDistance;
    private TextView tvUnit;

    private Button btnLogShot;
    private TextView tvStatus;

    // No round screen
    private TextView tvNoRoundHint;
    private Button btnRetrySync;

    // Club picker
    private LinearLayout containerClubList;
    private Button btnCancelPicker;

    // Shot details (Lie & Direction)
    private TextView tvShotClubName;
    private Button btnLieFairway;
    private Button btnLieRough;
    private Button btnLieSand;
    private Button btnLieGreen;

    private Button btnDirLeft;
    private Button btnDirStraight;
    private Button btnDirRight;

    private Button btnCancelShot;
    private Button btnConfirmShot;

    // Success overlay
    private TextView tvSuccessClub;
    private TextView tvSuccessDetails;

    // Hardware
    private Vibrator vibrator;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService backgroundExecutor = Executors.newSingleThreadExecutor();

    // Round state
    private int currentHole = 1;
    private int currentPar = 4;
    private boolean isRoundActive = false;

    // Active shot selection state
    private String selectedClubId = "";
    private String selectedClubName = "";
    private String selectedLie = "fairway";
    private String selectedDirection = "straight";

    private final BroadcastReceiver closeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            Log.i(TAG, "Close app broadcast received from service/phone");
            isRoundActive = false;
            updateOngoingActivityNotification(false, 0, 0, "");
            finishAffinity();
        }
    };

    private static class ClubItem {
        final String id;
        final String shortName;
        final String name;

        ClubItem(String id, String shortName, String name) {
            this.id = id;
            this.shortName = shortName;
            this.name = name;
        }
    }

    private static final ClubItem[] DEFAULT_CLUBS = new ClubItem[] {
        new ClubItem("dr", "D", "Driver"),
        new ClubItem("3w", "3W", "3 Wood"),
        new ClubItem("5w", "5W", "5 Wood"),
        new ClubItem("3h", "3H", "3 Hybrid"),
        new ClubItem("4h", "4H", "4 Hybrid"),
        new ClubItem("4i", "4I", "4 Iron"),
        new ClubItem("5i", "5I", "5 Iron"),
        new ClubItem("6i", "6I", "6 Iron"),
        new ClubItem("7i", "7I", "7 Iron"),
        new ClubItem("8i", "8I", "8 Iron"),
        new ClubItem("9i", "9I", "9 Iron"),
        new ClubItem("pw", "PW", "Pitching Wedge"),
        new ClubItem("gw", "GW", "Gap Wedge"),
        new ClubItem("sw", "SW", "Sand Wedge"),
        new ClubItem("lw", "LW", "Lob Wedge"),
        new ClubItem("pt", "PT", "Putter")
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Prevent screen timeout while using PocketCaddy on watch
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_main);

        initViews();
        initHardware();
        setupListeners();

        // Register close broadcast
        IntentFilter filter = new IntentFilter("com.pocketcaddy.wear.ACTION_CLOSE_APP");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(closeReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(closeReceiver, filter);
        }

        // Request POST_NOTIFICATIONS runtime permission for Ongoing Activity & Samsung Now Bar
        requestNotificationPermission();

        if (getIntent() != null && getIntent().hasExtra("scanned_club_name")) {
            String clubName = getIntent().getStringExtra("scanned_club_name");
            showScannedConfirmation(clubName);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.hasExtra("scanned_club_name")) {
            String clubName = intent.getStringExtra("scanned_club_name");
            showScannedConfirmation(clubName);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.i(TAG, "Requesting POST_NOTIFICATIONS runtime permission for Samsung Now Bar / Ongoing Activity");
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQ_NOTIFICATIONS);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_NOTIFICATIONS && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            Log.i(TAG, "POST_NOTIFICATIONS permission granted by user");
            if (isRoundActive) {
                updateOngoingActivityNotification(true, currentHole, -1, "yd");
            }
        }
    }

    private void initViews() {
        layoutMain = findViewById(R.id.layoutMain);
        layoutNoRound = findViewById(R.id.layoutNoRound);
        layoutClubPicker = findViewById(R.id.layoutClubPicker);
        layoutShotDetails = findViewById(R.id.layoutShotDetails);
        layoutSuccess = findViewById(R.id.layoutSuccess);

        btnPrevHole = findViewById(R.id.btnPrevHole);
        btnNextHole = findViewById(R.id.btnNextHole);
        tvHoleInfo = findViewById(R.id.tvHoleInfo);

        tvFrontDistance = findViewById(R.id.tvFrontDistance);
        tvPinDistance = findViewById(R.id.tvPinDistance);
        tvBackDistance = findViewById(R.id.tvBackDistance);
        tvUnit = findViewById(R.id.tvUnit);

        btnLogShot = findViewById(R.id.btnLogShot);
        tvStatus = findViewById(R.id.tvStatus);

        tvNoRoundHint = findViewById(R.id.tvNoRoundHint);
        btnRetrySync = findViewById(R.id.btnRetrySync);

        containerClubList = findViewById(R.id.containerClubList);
        btnCancelPicker = findViewById(R.id.btnCancelPicker);

        tvShotClubName = findViewById(R.id.tvShotClubName);
        btnLieFairway = findViewById(R.id.btnLieFairway);
        btnLieRough = findViewById(R.id.btnLieRough);
        btnLieSand = findViewById(R.id.btnLieSand);
        btnLieGreen = findViewById(R.id.btnLieGreen);

        btnDirLeft = findViewById(R.id.btnDirLeft);
        btnDirStraight = findViewById(R.id.btnDirStraight);
        btnDirRight = findViewById(R.id.btnDirRight);

        btnCancelShot = findViewById(R.id.btnCancelShot);
        btnConfirmShot = findViewById(R.id.btnConfirmShot);

        tvSuccessClub = findViewById(R.id.tvSuccessClub);
        tvSuccessDetails = findViewById(R.id.tvSuccessDetails);
    }

    private void initHardware() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Exception ignored) {}
    }

    private void setupListeners() {
        btnPrevHole.setOnClickListener(v -> sendHoleChange("prev"));
        btnNextHole.setOnClickListener(v -> sendHoleChange("next"));

        // Open Club Picker
        btnLogShot.setOnClickListener(v -> {
            vibrateClick();
            openClubPicker();
        });

        btnCancelPicker.setOnClickListener(v -> closeClubPicker());

        btnRetrySync.setOnClickListener(v -> {
            vibrateClick();
            tvNoRoundHint.setText("Connecting to phone…");
            requestDistancesFromPhone();
        });

        // Lie options listeners
        btnLieFairway.setOnClickListener(v -> selectLie("fairway"));
        btnLieRough.setOnClickListener(v -> selectLie("rough"));
        btnLieSand.setOnClickListener(v -> selectLie("sand"));
        btnLieGreen.setOnClickListener(v -> selectLie("green"));

        // Direction options listeners
        btnDirLeft.setOnClickListener(v -> selectDirection("left"));
        btnDirStraight.setOnClickListener(v -> selectDirection("straight"));
        btnDirRight.setOnClickListener(v -> selectDirection("right"));

        // Shot action buttons
        btnCancelShot.setOnClickListener(v -> {
            vibrateSubtle();
            openClubPicker();
        });

        btnConfirmShot.setOnClickListener(v -> confirmAndSaveShot());
    }

    @Override
    protected void onResume() {
        super.onResume();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Wearable.getMessageClient(this).addListener(this);
        requestDistancesFromPhone();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(closeReceiver);
        } catch (Exception ignored) {}
        backgroundExecutor.shutdown();
    }

    // ==========================================
    // Ongoing Activity on Watch Face (Samsung Now Bar)
    // ==========================================

    private void updateOngoingActivityNotification(boolean roundActive, int hole, int pin, String unit) {
        try {
            Intent serviceIntent = new Intent(this, PocketCaddyWearService.class);
            if (!roundActive) {
                serviceIntent.setAction(PocketCaddyWearService.ACTION_STOP);
                startService(serviceIntent);
                return;
            }

            serviceIntent.setAction(PocketCaddyWearService.ACTION_UPDATE);
            serviceIntent.putExtra(PocketCaddyWearService.EXTRA_HOLE, hole);
            serviceIntent.putExtra(PocketCaddyWearService.EXTRA_PIN, pin);
            serviceIntent.putExtra(PocketCaddyWearService.EXTRA_UNIT, unit);
            serviceIntent.putExtra(PocketCaddyWearService.EXTRA_COURSE, "PocketCaddy");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to update ongoing activity service: " + e.getMessage());
        }
    }

    // ==========================================
    // Shot Logging Workflow
    // ==========================================

    private void openClubPicker() {
        if (layoutMain != null) layoutMain.setVisibility(View.GONE);
        if (layoutShotDetails != null) layoutShotDetails.setVisibility(View.GONE);
        if (layoutSuccess != null) layoutSuccess.setVisibility(View.GONE);
        if (layoutNoRound != null) layoutNoRound.setVisibility(View.GONE);
        if (layoutClubPicker != null) layoutClubPicker.setVisibility(View.VISIBLE);

        populateClubList();
    }

    private void closeClubPicker() {
        vibrateSubtle();
        if (layoutClubPicker != null) layoutClubPicker.setVisibility(View.GONE);
        if (layoutShotDetails != null) layoutShotDetails.setVisibility(View.GONE);
        if (layoutMain != null) layoutMain.setVisibility(View.VISIBLE);
    }

    private void populateClubList() {
        if (containerClubList == null || containerClubList.getChildCount() > 0) {
            return;
        }

        int dp32 = (int) (32 * getResources().getDisplayMetrics().density);
        int dp2 = (int) (2 * getResources().getDisplayMetrics().density);

        for (ClubItem club : DEFAULT_CLUBS) {
            Button btn = new Button(this);
            btn.setText(club.shortName + "  ·  " + club.name);
            btn.setTextColor(Color.WHITE);
            btn.setTextSize(11);
            btn.setBackgroundResource(R.drawable.btn_club_item_bg);
            btn.setAllCaps(false);

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp32
            );
            lp.setMargins(0, dp2, 0, dp2);
            btn.setLayoutParams(lp);

            btn.setOnClickListener(v -> onClubChosen(club.id, club.name));
            containerClubList.addView(btn);
        }
    }

    private void onClubChosen(String clubId, String clubName) {
        vibrateClick();
        selectedClubId = clubId;
        selectedClubName = clubName;

        // If Putter: Putters automatically land on Green and go straight -> save directly!
        if ("pt".equalsIgnoreCase(clubId) || clubName.toLowerCase().contains("putter")) {
            selectedLie = "green";
            selectedDirection = "straight";
            dispatchShotAndShowSuccess(clubId, clubName, "green", "straight");
            return;
        }

        // For all other clubs: Open Shot Details overlay (Lie & Direction)
        selectedLie = "fairway";
        selectedDirection = "straight";
        updateLiePillsUI();
        updateDirectionPillsUI();

        if (tvShotClubName != null) {
            tvShotClubName.setText(clubName);
        }

        if (layoutClubPicker != null) layoutClubPicker.setVisibility(View.GONE);
        if (layoutShotDetails != null) layoutShotDetails.setVisibility(View.VISIBLE);
    }

    private void selectLie(String lie) {
        vibrateClick();
        selectedLie = lie;
        updateLiePillsUI();
    }

    private void updateLiePillsUI() {
        int colorActiveText = Color.WHITE;
        int colorInactiveText = getResources().getColor(R.color.text_muted);

        btnLieFairway.setBackgroundResource("fairway".equals(selectedLie) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnLieFairway.setTextColor("fairway".equals(selectedLie) ? colorActiveText : colorInactiveText);

        btnLieRough.setBackgroundResource("rough".equals(selectedLie) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnLieRough.setTextColor("rough".equals(selectedLie) ? colorActiveText : colorInactiveText);

        btnLieSand.setBackgroundResource("sand".equals(selectedLie) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnLieSand.setTextColor("sand".equals(selectedLie) ? colorActiveText : colorInactiveText);

        btnLieGreen.setBackgroundResource("green".equals(selectedLie) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnLieGreen.setTextColor("green".equals(selectedLie) ? colorActiveText : colorInactiveText);
    }

    private void selectDirection(String dir) {
        vibrateClick();
        selectedDirection = dir;
        updateDirectionPillsUI();
    }

    private void updateDirectionPillsUI() {
        int colorActiveText = Color.WHITE;
        int colorInactiveText = getResources().getColor(R.color.text_muted);

        btnDirLeft.setBackgroundResource("left".equals(selectedDirection) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnDirLeft.setTextColor("left".equals(selectedDirection) ? colorActiveText : colorInactiveText);

        btnDirStraight.setBackgroundResource("straight".equals(selectedDirection) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnDirStraight.setTextColor("straight".equals(selectedDirection) ? colorActiveText : colorInactiveText);

        btnDirRight.setBackgroundResource("right".equals(selectedDirection) ? R.drawable.btn_pill_active : R.drawable.btn_pill_inactive);
        btnDirRight.setTextColor("right".equals(selectedDirection) ? colorActiveText : colorInactiveText);
    }

    private void confirmAndSaveShot() {
        dispatchShotAndShowSuccess(selectedClubId, selectedClubName, selectedLie, selectedDirection);
    }

    private void dispatchShotAndShowSuccess(String clubId, String clubName, String lie, String direction) {
        vibrateHeavy();
        sendShotToPhone(clubId, clubName, lie, direction);

        mainHandler.post(() -> {
            if (layoutClubPicker != null) layoutClubPicker.setVisibility(View.GONE);
            if (layoutShotDetails != null) layoutShotDetails.setVisibility(View.GONE);

            if (tvSuccessClub != null) tvSuccessClub.setText(clubName + " Logged!");
            if (tvSuccessDetails != null) {
                String lieCap = lie.substring(0, 1).toUpperCase() + lie.substring(1);
                String dirCap = direction.substring(0, 1).toUpperCase() + direction.substring(1);
                tvSuccessDetails.setText(lieCap + " · " + dirCap);
            }
            if (layoutSuccess != null) layoutSuccess.setVisibility(View.VISIBLE);

            mainHandler.postDelayed(() -> {
                if (layoutSuccess != null) layoutSuccess.setVisibility(View.GONE);
                if (layoutMain != null) layoutMain.setVisibility(View.VISIBLE);
                if (tvStatus != null) {
                    tvStatus.setText("Logged: " + clubName + " (" + lie + ")");
                }
            }, 1500);
        });
    }

    private void showScannedConfirmation(String clubName) {
        wakeWatchScreen();
        vibrateHeavy();
        playWatchChime();

        if (layoutClubPicker != null) layoutClubPicker.setVisibility(View.GONE);
        if (layoutShotDetails != null) layoutShotDetails.setVisibility(View.GONE);

        if (tvSuccessClub != null) tvSuccessClub.setText(clubName + " Scanned!");
        if (tvSuccessDetails != null) tvSuccessDetails.setText("Scanned on Phone");
        if (layoutSuccess != null) layoutSuccess.setVisibility(View.VISIBLE);

        if (tvStatus != null) {
            tvStatus.setText("Scanned: " + clubName);
        }

        mainHandler.postDelayed(() -> {
            if (layoutSuccess != null) layoutSuccess.setVisibility(View.GONE);
            if (layoutMain != null) layoutMain.setVisibility(View.VISIBLE);
        }, 2000);
    }

    private void playWatchChime() {
        try {
            Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            Ringtone r = RingtoneManager.getRingtone(getApplicationContext(), notificationUri);
            if (r != null) {
                r.play();
            }
        } catch (Exception e1) {
            try {
                ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100);
                tg.startTone(ToneGenerator.TONE_PROP_BEEP2, 220);
            } catch (Exception ignored) {}
        }
    }

    private void wakeWatchScreen() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock wl = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "PocketCaddyWear:ScanWakeLock"
                );
                wl.acquire(2500);
            }
        } catch (Exception ignored) {}
    }

    private void sendShotToPhone(String clubId, String clubName, String lie, String direction) {
        backgroundExecutor.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("clubId", clubId != null ? clubId : "");
                payload.put("clubName", clubName != null ? clubName : "");
                payload.put("lie", lie != null ? lie : "fairway");
                payload.put("direction", direction != null ? direction : "straight");
                payload.put("timestamp", System.currentTimeMillis());

                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);

                List<Node> nodes = Tasks.await(Wearable.getNodeClient(this).getConnectedNodes());
                for (Node node : nodes) {
                    Wearable.getMessageClient(this).sendMessage(node.getId(), PATH_LOG_SHOT, bytes);
                }
            } catch (Exception ignored) {}
        });
    }

    // ==========================================
    // Phone Sync & Messaging
    // ==========================================

    private void requestDistancesFromPhone() {
        backgroundExecutor.execute(() -> {
            try {
                List<Node> nodes = Tasks.await(Wearable.getNodeClient(this).getConnectedNodes());
                Log.d(TAG, "Requesting distances from " + nodes.size() + " connected nodes");
                for (Node node : nodes) {
                    Wearable.getMessageClient(this).sendMessage(
                        node.getId(),
                        PATH_REQUEST_SYNC,
                        new byte[0]
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    private void sendHoleChange(String direction) {
        vibrateClick();
        backgroundExecutor.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("action", direction);
                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);

                List<Node> nodes = Tasks.await(Wearable.getNodeClient(this).getConnectedNodes());
                for (Node node : nodes) {
                    Wearable.getMessageClient(this).sendMessage(node.getId(), PATH_HOLE_CHANGE, bytes);
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onMessageReceived(@NonNull MessageEvent messageEvent) {
        String path = messageEvent.getPath();

        if (PATH_CLOSE_ROUND.equals(path)) {
            Log.i(TAG, "Received close_round message from phone");
            isRoundActive = false;
            mainHandler.post(() -> {
                updateOngoingActivityNotification(false, 0, 0, "");
                finishAffinity();
            });
            return;
        }

        if (PATH_CLUB_SCANNED.equals(path)) {
            try {
                String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                JSONObject data = new JSONObject(jsonStr);
                final String clubName = data.optString("clubName", "Club");
                mainHandler.post(() -> showScannedConfirmation(clubName));
            } catch (Exception ignored) {}
            return;
        }

        if (PATH_DISTANCES.equals(path) || PATH_START_ROUND.equals(path)) {
            try {
                String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                JSONObject data = new JSONObject(jsonStr);

                final boolean roundActive = data.optBoolean("roundActive", true);
                final int hole = data.optInt("hole", currentHole);
                final int par = data.optInt("par", currentPar);
                final int front = data.optInt("front", -1);
                final int pin = data.optInt("pin", -1);
                final int back = data.optInt("back", -1);
                final String unit = data.optString("unit", "yd");

                isRoundActive = roundActive;

                mainHandler.post(() -> {
                    if (!roundActive) {
                        updateOngoingActivityNotification(false, 0, 0, "");
                        finishAffinity();
                        return;
                    }

                    layoutNoRound.setVisibility(View.GONE);
                    if (layoutClubPicker.getVisibility() != View.VISIBLE &&
                        layoutShotDetails.getVisibility() != View.VISIBLE &&
                        layoutSuccess.getVisibility() != View.VISIBLE) {
                        layoutMain.setVisibility(View.VISIBLE);
                    }

                    currentHole = hole;
                    currentPar = par;

                    tvHoleInfo.setText(String.format("Hole %d • Par %d", hole, par));
                    tvFrontDistance.setText(front >= 0 ? String.valueOf(front) : "---");
                    tvPinDistance.setText(pin >= 0 ? String.valueOf(pin) : "---");
                    tvBackDistance.setText(back >= 0 ? String.valueOf(back) : "---");
                    tvUnit.setText(unit.toUpperCase());
                    if (tvStatus != null && "Waiting for phone sync…".equals(tvStatus.getText().toString())) {
                        tvStatus.setText("Synced with PocketCaddy");
                    }

                    updateOngoingActivityNotification(true, hole, pin, unit);
                });
            } catch (Exception ignored) {}
        }
    }

    // ==========================================
    // Haptics Helpers
    // ==========================================

    private void vibrateSubtle() {
        if (vibrator == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK));
            } else {
                vibrator.vibrate(40);
            }
        } catch (Exception ignored) {}
    }

    private void vibrateClick() {
        if (vibrator == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK));
            } else {
                vibrator.vibrate(30);
            }
        } catch (Exception ignored) {}
    }

    private void vibrateHeavy() {
        if (vibrator == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK));
            } else {
                long[] pattern = {0, 150, 50, 200};
                vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {}
    }
}

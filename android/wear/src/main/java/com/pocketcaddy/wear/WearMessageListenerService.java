package com.pocketcaddy.wear;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

public class WearMessageListenerService extends WearableListenerService {

    private static final String TAG = "PocketCaddyWearService";
    private static final String CHANNEL_ID = "pocketcaddy_round_alerts";
    private static final int NOTIF_ID = 4040;

    @Override
    public void onMessageReceived(@NonNull MessageEvent messageEvent) {
        String path = messageEvent.getPath();
        Log.i(TAG, "Background message received on watch: " + path);

        if ("/pocketcaddy/close_round".equals(path)) {
            Log.i(TAG, "Close round signal received from phone");
            handleCloseRound();
            return;
        }

        if ("/pocketcaddy/club_scanned".equals(path)) {
            try {
                String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                JSONObject json = new JSONObject(jsonStr);
                String clubName = json.optString("clubName", "Club");
                Intent intent = new Intent(this, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.putExtra("scanned_club_name", clubName);
                startActivity(intent);
            } catch (Exception ignored) {}
            return;
        }

        if ("/pocketcaddy/launch".equals(path) || "/pocketcaddy/start_round".equals(path)) {
            boolean shouldLaunch = true;
            String courseTitle = "Active Round";

            if (messageEvent.getData() != null && messageEvent.getData().length > 0) {
                try {
                    String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                    JSONObject json = new JSONObject(jsonStr);
                    shouldLaunch = json.optBoolean("roundActive", true);
                    courseTitle = json.optString("courseName", "Active Round");
                } catch (Exception ignored) {}
            }

            if (shouldLaunch) {
                launchWatchApp(courseTitle);
            } else {
                handleCloseRound();
            }
        }
    }

    private void handleCloseRound() {
        try {
            // 1. Stop Foreground Service so watch face icon disappears
            Intent serviceIntent = new Intent(this, PocketCaddyWearService.class);
            serviceIntent.setAction(PocketCaddyWearService.ACTION_STOP);
            startService(serviceIntent);

            // 2. Broadcast to MainActivity to finish
            Intent closeIntent = new Intent("com.pocketcaddy.wear.ACTION_CLOSE_APP");
            closeIntent.setPackage(getPackageName());
            sendBroadcast(closeIntent);
        } catch (Exception e) {
            Log.w(TAG, "Failed to handle close round on watch: " + e.getMessage());
        }
    }

    private void launchWatchApp(String courseTitle) {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

            // Attempt direct launch
            try {
                startActivity(intent);
            } catch (Exception e) {
                Log.d(TAG, "Direct background launch deferred to notification: " + e.getMessage());
            }

            // Post auto-presenting heads up / full screen notification for modern Wear OS restrictions
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Round Start Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                    );
                    channel.setDescription("Alerts when a round starts on phone");
                    nm.createNotificationChannel(channel);
                }

                NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentTitle("PocketCaddy Round Active")
                    .setContentText("Tap to open live yardages for " + courseTitle)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)
                    .setFullScreenIntent(pendingIntent, true);

                nm.notify(NOTIF_ID, builder.build());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch watch app: " + e.getMessage());
        }
    }
}

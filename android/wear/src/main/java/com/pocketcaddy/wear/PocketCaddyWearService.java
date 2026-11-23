package com.pocketcaddy.wear;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.wear.ongoing.OngoingActivity;
import androidx.wear.ongoing.Status;

public class PocketCaddyWearService extends Service {

    private static final String TAG = "PocketCaddyWearService";

    public static final String ACTION_UPDATE = "com.pocketcaddy.wear.action.UPDATE_ROUND";
    public static final String ACTION_STOP = "com.pocketcaddy.wear.action.STOP_ROUND";

    public static final String EXTRA_HOLE = "extra_hole";
    public static final String EXTRA_PIN = "extra_pin";
    public static final String EXTRA_UNIT = "extra_unit";
    public static final String EXTRA_COURSE = "extra_course";

    private static final int NOTIFICATION_ID = 5050;
    private static final String CHANNEL_ID = "pocketcaddy_ongoing_round";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            Log.i(TAG, "Stopping ongoing Wear round service");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        int hole = intent.getIntExtra(EXTRA_HOLE, 1);
        int pin = intent.getIntExtra(EXTRA_PIN, -1);
        String unit = intent.getStringExtra(EXTRA_UNIT);
        String course = intent.getStringExtra(EXTRA_COURSE);

        promoteToForeground(hole, pin, unit, course);

        return START_STICKY;
    }

    private void promoteToForeground(int hole, int pin, String unit, String course) {
        try {
            createNotificationChannel();

            Intent appIntent = new Intent(this, MainActivity.class);
            appIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            String statusText = (pin >= 0)
                ? String.format("Hole %d • %d %s", hole, pin, unit != null ? unit.toLowerCase() : "yd")
                : String.format("Hole %d", hole);

            String title = (course != null && !course.isEmpty()) ? course : "PocketCaddy";

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_ongoing_flag)
                .setContentTitle(title)
                .setContentText(statusText)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(pendingIntent);

            Status status = new Status.Builder()
                .addTemplate(statusText)
                .build();

            OngoingActivity ongoingActivity = new OngoingActivity.Builder(
                this,
                NOTIFICATION_ID,
                builder
            )
                .setStaticIcon(R.drawable.ic_ongoing_flag)
                .setTouchIntent(pendingIntent)
                .setStatus(status)
                .build();

            ongoingActivity.apply(this);

            Notification notification = builder.build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to promote wear service to foreground: " + e.getMessage(), e);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "PocketCaddy Ongoing Round",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Ongoing round indicator for watch face");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
